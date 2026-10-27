import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, "../../migrations");
const LOCK_ID = 727274; // arbitrary app-wide advisory-lock key

/**
 * Applies pending *.sql files in name order. Each file runs in its own transaction and is
 * recorded in schema_migrations, so running this twice (or from two servers) is safe.
 */
export async function migrate(pool, { dir = MIGRATIONS_DIR, log = console.log } = {}) {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`create table if not exists schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`);
    const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const applied = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await fs.readFile(path.join(dir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations(name) values ($1)", [file]);
        await client.query("commit");
        applied.push(file);
        log(`[migrate] applied ${file}`);
      } catch (err) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${err.message}`, { cause: err });
      }
    }
    if (!applied.length) log("[migrate] database is up to date");
    return applied;
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    client.release();
  }
}

// CLI: `npm run migrate`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { loadConfig } = await import("../config.js");
  const { createPool } = await import("./pool.js");
  const pool = createPool(loadConfig());
  try {
    await migrate(pool);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
