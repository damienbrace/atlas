// Schedules Atlas's background jobs in Supabase (pg_cron + pg_net): every 5 minutes it
// calls /api/cron/sync so mail downloads and gets sorted with every browser closed, and
// at 5:00am Perth time /api/cron/brief sends the morning brief to your phone.
// Run with `npm run db:cron -- https://your-atlas-address` (again whenever the address changes).

import postgres from "postgres";

const appUrl = process.argv[2]?.replace(/\/$/, "");
if (!appUrl?.startsWith("https://")) {
  console.error("Give Atlas's https address, e.g. npm run db:cron -- https://atlas-mu-dun.vercel.app");
  process.exit(1);
}
if (!process.env.DATABASE_URL || !process.env.CRON_SECRET) {
  console.error("DATABASE_URL and CRON_SECRET must be set in .env.local.");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max_pipeline: 0, max: 1, onnotice: () => {} });

// pg_net doesn't wait for the job to finish: the route answers at once and works afterwards.
const call = (path) => `
  select net.http_post(
    url := '${appUrl}${path}',
    headers := jsonb_build_object('Authorization', 'Bearer ${process.env.CRON_SECRET}'),
    timeout_milliseconds := 10000
  )`;

// pg_cron runs on UTC. Perth is UTC+8 all year (no daylight saving), so 21:00 UTC is 5:00am.
const JOBS = [
  { name: "atlas-sync", schedule: "*/5 * * * *", command: call("/api/cron/sync") },
  { name: "atlas-brief", schedule: "0 21 * * *", command: call("/api/cron/brief") },
];

try {
  await sql`create extension if not exists pg_cron with schema pg_catalog`;
  await sql`create extension if not exists pg_net with schema extensions`;
  for (const job of JOBS) {
    // Same name replaces the old job, so re-running just updates the address.
    await sql`select cron.schedule(${job.name}, ${job.schedule}, ${job.command})`;
  }
  const jobs = await sql`select jobname, schedule, active from cron.job where jobname like 'atlas-%' order by jobname`;
  for (const j of jobs) console.log(`${j.jobname.padEnd(14)} ${j.schedule.padEnd(14)} ${j.active ? "on" : "off"}  → ${appUrl}`);
} finally {
  await sql.end();
}
