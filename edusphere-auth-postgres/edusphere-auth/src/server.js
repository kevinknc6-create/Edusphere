import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { migrate } from "./db/migrate.js";
import { createApp } from "./app.js";

const config = loadConfig();
const pool = createPool(config);

// Opt-in only: production deployments normally run `npm run migrate` as a separate release step.
if (process.env.AUTO_MIGRATE === "true") await migrate(pool);

const app = createApp({ config, pool });
const server = app.listen(config.port, () => {
  console.log(`EduSphere auth listening on ${config.baseUrl} (port ${config.port})`);
  if (!config.google.clientId) console.log("Google sign-in: not configured (set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)");
});

const shutdown = (signal) => {
  console.log(`${signal} received, shutting down`);
  server.close(async () => { await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
