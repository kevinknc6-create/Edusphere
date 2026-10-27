import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { withTransaction, isUniqueViolation } from "../db/pool.js";
import { hashPassword, verifyPassword, needsRehash, dummyHash } from "../security/password.js";
import { newToken, hashToken } from "../security/tokens.js";
import {
  HttpError, parse, registerSchema, loginSchema, forgotSchema, resetSchema, tokenSchema,
} from "../validation.js";
import { startSession, endSession, requireAuth, SESSION_COOKIE_DEV, SESSION_COOKIE_PROD } from "../session.js";

const GENERIC_LOGIN_ERROR = "Incorrect email or password. Please try again.";
const VERIFY_TTL_MS = 24 * 36e5;
const RESET_TTL_MS = 60 * 6e4;

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function limiter({ windowMs, limit, key, skipSuccessfulRequests = false, message }) {
  return rateLimit({
    windowMs, limit, skipSuccessfulRequests,
    standardHeaders: "draft-7", legacyHeaders: false,
    keyGenerator: (req) => {
      const ip = ipKeyGenerator(req.ip ?? "");
      return key ? `${ip}|${key(req)}` : ip;
    },
    handler: (_req, res) =>
      res.status(429).json({ error: { code: "rate_limited", message: message || "Too many attempts. Please wait a few minutes and try again." } }),
  });
}

export function createAuthRouter({ config, pool, csrf, mailer, google }) {
  const r = express.Router();
  const bodyEmail = (req) => String(req.body?.email ?? "").trim().toLowerCase().slice(0, 254);
  const hour = 60 * 6e4;

  r.use(limiter({ windowMs: config.limits.windowMs, limit: config.limits.general }));

  r.get("/csrf", (req, res) => csrf.issue(req, res));
  r.use(csrf.protect);

  /* ---------- helpers ---------- */
  async function createEmailToken(client, userId, purpose, ttlMs) {
    const { token, hash } = newToken();
    // One live token per purpose per user: older links stop working.
    await client.query("delete from email_tokens where user_id = $1 and purpose = $2", [userId, purpose]);
    await client.query(
      "insert into email_tokens (user_id, purpose, token_hash, expires_at) values ($1, $2, $3, now() + ($4 || ' milliseconds')::interval)",
      [userId, purpose, hash, String(ttlMs)]
    );
    return token;
  }

  const sendQuietly = (message) =>
    mailer.send(message).catch((err) => console.error("[mail] failed to send:", err.message));

  const verifyMail = (user, token) => ({
    to: user.email,
    subject: "Confirm your EduSphere email",
    text: `Hi ${user.name},\n\nConfirm your email address to finish setting up EduSphere:\n${config.baseUrl}/#verify-email=${token}\n\nThis link expires in 24 hours. If you didn't create an account, you can ignore this email.`,
  });

  /* ---------- register ---------- */
  r.post("/register",
    limiter({ windowMs: hour, limit: config.limits.register, message: "Too many sign-ups from this network. Please try again later." }),
    asyncH(async (req, res) => {
      const { name, email, password } = parse(registerSchema, req.body);
      const passwordHash = await hashPassword(password);

      let user, token;
      try {
        // User row and verification token are created atomically.
        ({ user, token } = await withTransaction(pool, async (c) => {
          const { rows: [u] } = await c.query(
            "insert into users (email, name, password_hash) values ($1, $2, $3) returning id, email, name",
            [email, name, passwordHash]
          );
          return { user: u, token: await createEmailToken(c, u.id, "verify_email", VERIFY_TTL_MS) };
        }));
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new HttpError(409, "email_taken",
            "An account with this email already exists. Sign in, or reset your password if you forgot it.",
            { email: "This email is already registered." });
        }
        throw err;
      }

      void sendQuietly(verifyMail(user, token));
      await startSession(req, { userId: user.id, remember: false, config });
      res.status(201).json({ ok: true, redirect: config.postLoginPath });
    }));

  /* ---------- login ---------- */
  r.post("/login",
    limiter({ windowMs: config.limits.windowMs, limit: config.limits.login, key: bodyEmail, skipSuccessfulRequests: true }),
    asyncH(async (req, res) => {
      const { email, password, remember } = parse(loginSchema, req.body);
      const { rows: [user] } = await pool.query(
        "select id, password_hash from users where lower(email) = $1", [email]);

      // Always run one Argon2 verification, so unknown accounts cost the same time as wrong passwords.
      const ok = await verifyPassword(user?.password_hash || (await dummyHash()), password);
      if (!user || !user.password_hash || !ok) {
        throw new HttpError(401, "invalid_credentials", GENERIC_LOGIN_ERROR);
      }

      if (needsRehash(user.password_hash)) {
        const upgraded = await hashPassword(password);
        await pool.query("update users set password_hash = $1, updated_at = now() where id = $2", [upgraded, user.id]);
      }
      await startSession(req, { userId: user.id, remember, config });
      res.json({ ok: true, redirect: config.postLoginPath });
    }));

  /* ---------- logout ---------- */
  r.post("/logout", asyncH(async (req, res) => {
    await endSession(req).catch(() => {});
    res.clearCookie(config.isProd ? SESSION_COOKIE_PROD : SESSION_COOKIE_DEV, {
      path: "/", httpOnly: true, secure: config.isProd, sameSite: "lax",
    });
    res.json({ ok: true });
  }));

  /* ---------- current user ---------- */
  r.get("/me", requireAuth(), asyncH(async (req, res) => {
    const { rows: [u] } = await pool.query(
      `select u.id, u.name, u.email, u.email_verified_at is not null as email_verified,
              u.password_hash is not null as has_password,
              coalesce((select array_agg(provider) from auth_identities i where i.user_id = u.id), '{}') as providers
         from users u where u.id = $1`, [req.session.userId]);
    if (!u) { await endSession(req).catch(() => {}); throw new HttpError(401, "unauthenticated", "Please sign in."); }
    res.json({
      user: { id: u.id, name: u.name, email: u.email, emailVerified: u.email_verified, hasPassword: u.has_password, providers: u.providers },
    });
  }));

  /* ---------- email verification ---------- */
  r.post("/verify-email", asyncH(async (req, res) => {
    const { token } = parse(tokenSchema, req.body);
    const ok = await withTransaction(pool, async (c) => {
      const { rows: [t] } = await c.query(
        `update email_tokens set used_at = now()
          where token_hash = $1 and purpose = 'verify_email' and used_at is null and expires_at > now()
          returning user_id`, [hashToken(token)]);
      if (!t) return false;
      await c.query("update users set email_verified_at = coalesce(email_verified_at, now()), updated_at = now() where id = $1", [t.user_id]);
      return true;
    });
    if (!ok) throw new HttpError(400, "invalid_token", "This verification link is invalid or has expired.");
    res.json({ ok: true });
  }));

  r.post("/resend-verification", requireAuth(),
    limiter({ windowMs: hour, limit: 5, key: (req) => req.session?.userId || "" }),
    asyncH(async (req, res) => {
      const { rows: [u] } = await pool.query(
        "select id, email, name, email_verified_at from users where id = $1", [req.session.userId]);
      if (u && !u.email_verified_at) {
        const token = await withTransaction(pool, (c) => createEmailToken(c, u.id, "verify_email", VERIFY_TTL_MS));
        void sendQuietly(verifyMail(u, token));
      }
      res.status(202).json({ ok: true });
    }));

  /* ---------- forgot / reset password ---------- */
  r.post("/forgot-password",
    limiter({ windowMs: hour, limit: config.limits.forgot, key: bodyEmail, message: "Too many reset requests. Please try again later." }),
    asyncH(async (req, res) => {
      const { email } = parse(forgotSchema, req.body);
      // Same answer whether or not the account exists; the work happens after we reply.
      res.status(202).json({ ok: true });
      try {
        const { rows: [u] } = await pool.query("select id, email, name from users where lower(email) = $1", [email]);
        if (!u) return;
        const token = await withTransaction(pool, (c) => createEmailToken(c, u.id, "reset_password", RESET_TTL_MS));
        await sendQuietly({
          to: u.email,
          subject: "Reset your EduSphere password",
          text: `Hi ${u.name},\n\nChoose a new password using this link (valid for 1 hour):\n${config.baseUrl}/#new-password=${token}\n\nIf you didn't ask for this, you can ignore this email — your password won't change.`,
        });
      } catch (err) {
        console.error("[forgot-password]", err.message);
      }
    }));

  r.post("/reset-password", asyncH(async (req, res) => {
    const { token, password } = parse(resetSchema, req.body);
    const passwordHash = await hashPassword(password);
    const ok = await withTransaction(pool, async (c) => {
      const { rows: [t] } = await c.query(
        `update email_tokens set used_at = now()
          where token_hash = $1 and purpose = 'reset_password' and used_at is null and expires_at > now()
          returning user_id`, [hashToken(token)]);
      if (!t) return false;
      await c.query(
        `update users set password_hash = $1, email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
          where id = $2`, [passwordHash, t.user_id]);
      // Anyone already signed in with the old password is signed out everywhere.
      await c.query("delete from session where sess->>'userId' = $1::text", [t.user_id]);
      await c.query("delete from email_tokens where user_id = $1 and purpose = 'reset_password'", [t.user_id]);
      return true;
    });
    if (!ok) throw new HttpError(400, "invalid_token", "This reset link is invalid or has expired. Please request a new one.");
    res.json({ ok: true });
  }));

  /* ---------- Google (see routes/google.js) ---------- */
  r.use("/google", google);

  /* ---------- JSON 404 + errors ---------- */
  r.use((_req, res) => res.status(404).json({ error: { code: "not_found", message: "Not found." } }));
  r.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, fields: err.fields } });
    }
    if (err?.type === "entity.parse.failed") {
      return res.status(400).json({ error: { code: "bad_json", message: "Invalid request." } });
    }
    console.error("[auth] unexpected error:", err);
    res.status(500).json({ error: { code: "server_error", message: "Something went wrong on our side. Please try again." } });
  });

  return r;
}
