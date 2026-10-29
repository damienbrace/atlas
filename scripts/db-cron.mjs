// Schedules Atlas's background jobs in Supabase (pg_cron + pg_net): every 5 minutes it
// calls /api/cron/sync so mail downloads and gets sorted with every browser closed, at
// 4:45am /api/cron/money catches up with Up Bank, sorts new merchants and checks them, and
// at 5:00pm /api/cron/nudge sends a nudge if today's tasks aren't done.
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

// pg_cron runs on UTC. Perth is UTC+8 all year (no daylight saving): 21:00 UTC is 5:00am, 09:00 UTC is 5:00pm.
const JOBS = [
  { name: "atlas-money", schedule: "45 20 * * *", command: call("/api/cron/money") },
  { name: "atlas-nudge", schedule: "0 9 * * *", command: call("/api/cron/nudge") },
];

try {
  await sql`create extension if not exists pg_cron with schema pg_catalog`;
  await sql`create extension if not exists pg_net with schema extensions`;
  // The 5am brief push was retired (Hermes sends the morning brief); remove its job if it's still there.
  await sql`select cron.unschedule(jobname) from cron.job where jobname = 'atlas-brief'`;
  // Email sorting was retired too (Hermes handles email); remove the 5-minute mail sync.
  await sql`select cron.unschedule(jobname) from cron.job where jobname = 'atlas-sync'`;
  for (const job of JOBS) {
    // Same name replaces the old job, so re-running just updates the address.
    await sql`select cron.schedule(${job.name}, ${job.schedule}, ${job.command})`;
  }
  const jobs = await sql`select jobname, schedule, active from cron.job where jobname like 'atlas-%' order by jobname`;
  for (const j of jobs) console.log(`${j.jobname.padEnd(14)} ${j.schedule.padEnd(14)} ${j.active ? "on" : "off"}  → ${appUrl}`);
} finally {
  await sql.end();
}
