// Creates (or tops up) Atlas's tables in Supabase from supabase/schema.sql.
// Run with `npm run db:setup`; safe to run again.

import { readFile } from "node:fs/promises";
import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL isn't set in .env.local yet.");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max_pipeline: 0, max: 1, onnotice: () => {} });
try {
  const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  // No parameters, so this runs as one simple query and may hold many statements.
  await sql.unsafe(schema);
  const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  console.log(`Ready: ${tables.map((t) => t.tablename).join(", ")}`);
} finally {
  await sql.end();
}
