import session from "express-session";
import connectPgSimple from "connect-pg-simple";

export const SESSION_COOKIE_DEV = "edusphere.sid";
export const SESSION_COOKIE_PROD = "__Host-edusphere.sid";

/** express-session backed by PostgreSQL (the `session` table from the migration). */
export function createSessionMiddleware({ config, pool }) {
  const PgStore = connectPgSimple(session);
  return session({
    name: config.isProd ? SESSION_COOKIE_PROD : SESSION_COOKIE_DEV,
    secret: config.sessionSecret,
    store: new PgStore({
      pool,
      tableName: "session",
      createTableIfMissing: false,
      ttl: Math.floor(config.session.idleMs / 1000), // used for browser-session cookies
      pruneSessionInterval: 60 * 15,
    }),
    resave: false,
    saveUninitialized: false, // anonymous visitors never create session rows
    rolling: true,            // activity extends the idle window
    cookie: {
      httpOnly: true,
      secure: config.isProd,
      sameSite: "lax", // "lax" (not "strict") so the return trip from Google keeps the session
      path: "/",
      // no maxAge => browser-session cookie; "Remember me" sets one per session
    },
  });
}

const promisify = (fn) => new Promise((resolve, reject) => fn((err) => (err ? reject(err) : resolve())));

/**
 * Log a user in. The session id is regenerated first (prevents session fixation) and
 * anything the anonymous session held is discarded.
 */
export async function startSession(req, { userId, remember, config }) {
  await promisify((cb) => req.session.regenerate(cb));
  req.session.userId = String(userId);
  req.session.authAt = Date.now();
  if (remember) req.session.cookie.maxAge = config.session.rememberMs;
  await promisify((cb) => req.session.save(cb));
}

export const endSession = (req) => promisify((cb) => req.session.destroy(cb));

export function requireAuth({ page = false } = {}) {
  return (req, res, next) => {
    if (req.session?.userId) {
      res.set("Cache-Control", "no-store");
      return next();
    }
    if (page) return res.redirect(303, "/#signin");
    res.status(401).json({ error: { code: "unauthenticated", message: "Please sign in." } });
  };
}
