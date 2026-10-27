import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import { createSessionMiddleware, requireAuth } from "./session.js";
import { createCsrf } from "./security/csrf.js";
import { cookieParser } from "./security/cookies.js";
import { createAuthRouter } from "./routes/auth.js";
import { createGoogleRouter } from "./routes/google.js";
import { createMailer } from "./mailer.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(here, "../public");
const VIEWS_DIR = path.resolve(here, "../views");

/** Builds the Express app. Dependencies are injectable so tests can run it against a real database. */
export function createApp({ config, pool, googleClient, mailer = createMailer(config) }) {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
  }));

  app.use(cookieParser);
  app.use(express.json({ limit: "10kb" }));
  app.use(createSessionMiddleware({ config, pool }));

  const csrf = createCsrf({ secret: config.sessionSecret, baseUrl: config.baseUrl, isProd: config.isProd });
  const google = createGoogleRouter({ config, pool, client: googleClient });
  app.use("/api/auth", (req, res, next) => { res.set("Cache-Control", "no-store"); next(); },
    createAuthRouter({ config, pool, csrf, mailer, google }));

  // Protected page: only reachable with a valid session.
  app.get("/dashboard", requireAuth({ page: true }), (_req, res) => res.sendFile(path.join(VIEWS_DIR, "dashboard.html")));

  app.get("/healthz", async (_req, res) => {
    try { await pool.query("select 1"); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
  });

  app.use(express.static(PUBLIC_DIR, { index: "index.html", maxAge: config.isProd ? "1h" : 0 }));
  app.use((_req, res) => res.status(404).type("text").send("Not found"));

  app.use((err, _req, res, _next) => {
    console.error("[app] unexpected error:", err);
    res.status(500).type("text").send("Server error");
  });

  return app;
}
