import "dotenv/config";

/**
 * Reads and validates configuration from environment variables.
 * Secrets only ever come from the environment — never from code, never from the frontend.
 */
export function loadConfig(env = process.env) {
  const isProd = env.NODE_ENV === "production";
  const need = (name) => {
    const v = env[name];
    if (!v) throw new Error(`Missing required environment variable ${name} (see .env.example)`);
    return v;
  };

  const port = Number(env.PORT || 3000);
  const baseUrl = (env.APP_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, "");
  if (isProd && !baseUrl.startsWith("https://")) {
    throw new Error("APP_BASE_URL must be an https:// URL in production");
  }

  const sessionSecret = need("SESSION_SECRET");
  if (sessionSecret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");

  const num = (name, dflt) => (env[name] ? Number(env[name]) : dflt);

  return {
    isProd,
    port,
    baseUrl,
    databaseUrl: need("DATABASE_URL"),
    databaseSsl: env.DATABASE_SSL === "true",
    sessionSecret,
    trustProxy: env.TRUST_PROXY ? (Number.isNaN(Number(env.TRUST_PROXY)) ? env.TRUST_PROXY : Number(env.TRUST_PROXY)) : false,
    session: {
      // Browser-session cookie when "Remember me" is off; this long when it is on.
      rememberMs: num("SESSION_REMEMBER_DAYS", 30) * 864e5,
      idleMs: num("SESSION_IDLE_HOURS", 8) * 36e5,
    },
    google: {
      clientId: env.GOOGLE_CLIENT_ID || "",
      clientSecret: env.GOOGLE_CLIENT_SECRET || "",
      redirectUri: env.GOOGLE_REDIRECT_URI || `${baseUrl}/api/auth/google/callback`,
    },
    smtp: {
      host: env.SMTP_HOST || "",
      port: num("SMTP_PORT", 587),
      secure: env.SMTP_SECURE === "true",
      user: env.SMTP_USER || "",
      pass: env.SMTP_PASS || "",
      from: env.MAIL_FROM || "EduSphere <no-reply@localhost>",
    },
    limits: {
      windowMs: num("RATE_LIMIT_WINDOW_MINUTES", 15) * 60_000,
      login: num("RATE_LIMIT_LOGIN", 8),         // failed attempts per IP+email per window
      register: num("RATE_LIMIT_REGISTER", 10),  // per IP per hour
      forgot: num("RATE_LIMIT_FORGOT", 5),       // per IP+email per hour
      general: num("RATE_LIMIT_GENERAL", 120),   // all /api/auth requests per IP per window
    },
    postLoginPath: env.POST_LOGIN_PATH || "/dashboard",
  };
}
