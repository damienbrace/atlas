import "server-only";
import postgres from "postgres";

// Atlas's database: Supabase Postgres, reached through its transaction pooler
// (DATABASE_URL), shared by the desktop, the phone and the scheduled jobs.
// Times are stored as epoch milliseconds (bigint) and read back as numbers.

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL isn't set. Add Supabase's transaction pooler connection string to .env.local.");
  return postgres(url, {
    // The transaction pooler hands each query to any free connection, so no prepared statements.
    prepare: false,
    // One query at a time per connection: Supavisor's transaction mode stalls when a
    // query is queued behind one with a large result on the same connection.
    // This also breaks sql.begin (its BEGIN lands on any connection), so never use
    // sql.begin or sql.reserve here: write one statement, or several in one sql.unsafe.
    // @ts-expect-error postgres.js supports max_pipeline (src/index.js) but its types leave it out.
    max_pipeline: 0,
    max: 5,
    idle_timeout: 20,
    types: {
      bigint: { to: 20, from: [20], serialize: (n: number) => String(n), parse: (s: string) => Number(s) },
    },
  });
}

type Sql = ReturnType<typeof connect>;

// One pool per server process; kept on globalThis so dev hot reloads don't open new ones.
const shared = globalThis as unknown as { atlasSql?: Sql };

function instance(): Sql {
  return (shared.atlasSql ??= connect());
}

/** Tagged-template SQL (`sql\`SELECT …\``), connecting on first use. */
export const sql = new Proxy(function () {} as unknown as Sql, {
  apply: (_target, _this, args) => Reflect.apply(instance() as unknown as (...a: unknown[]) => unknown, undefined, args),
  get: (_target, prop) => {
    const value = Reflect.get(instance(), prop);
    return typeof value === "function" ? value.bind(instance()) : value;
  },
});

/**
 * A list of strings as a text[] value, for `= ANY (…)`, `ILIKE ANY (…)` or a text[]
 * column. It travels as JSON: postgres.js only learns the array types after its
 * first query, so `sql.array` can go out garbled on a fresh connection.
 */
export function textList(items: string[]) {
  return sql`ARRAY(SELECT jsonb_array_elements_text(${sql.json(items)}))`;
}
