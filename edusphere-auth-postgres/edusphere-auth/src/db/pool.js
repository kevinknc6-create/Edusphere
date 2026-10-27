import pg from "pg";

export function createPool(config) {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // An idle client erroring (e.g. DB restart) must not crash the process.
  pool.on("error", (err) => console.error("[pg] idle client error:", err.message));
  return pool;
}

/** Run `fn(client)` inside a transaction; commits on success, rolls back on any throw. */
export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export const isUniqueViolation = (err) => err && err.code === "23505";
