import express from "express";
import { OAuth2Client } from "google-auth-library";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { withTransaction, isUniqueViolation } from "../db/pool.js";
import { randomString, safeEqual } from "../security/tokens.js";
import { requireAuth, startSession } from "../session.js";

const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const STATE_TTL_MS = 10 * 60_000;
const RECENT_AUTH_MS = 15 * 60_000;
const NETWORK_CODES = /^(ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|UND_ERR_.*)$/;

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Google sign-in with the OpenID Connect *authorization code flow + PKCE*, handled entirely on the server:
 *  - /start        builds the Google URL (state, nonce, PKCE challenge kept in the server-side session)
 *  - /callback     exchanges the code, then verifies the ID token with Google's library
 *                  (signature, issuer, audience, expiry) plus nonce and email_verified
 *  - POST /link    lets an already signed-in user attach Google to their existing account
 * Accounts are identified by Google's immutable `sub`, never by email, and are never merged by email.
 *
 * `client` is injectable so tests can replace the two network calls; production uses the real library.
 */
export function createGoogleRouter({ config, pool, client }) {
  const r = express.Router();
  const { clientId, clientSecret, redirectUri } = config.google;
  const configured = Boolean(clientId && clientSecret);
  const oauth = client ?? (configured ? new OAuth2Client({ clientId, clientSecret, redirectUri }) : null);

  const cbLimiter = rateLimit({
    windowMs: config.limits.windowMs, limit: 30, standardHeaders: "draft-7", legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
    handler: (_req, res) => res.redirect(303, "/?auth_error=rate_limited#signin"),
  });

  const failLogin = (res, code) => res.redirect(303, `/?auth_error=${code}#signin`);
  const failLink = (res, code) => res.redirect(303, `/dashboard?link_error=${code}`);

  async function buildAuthUrl(req, intent) {
    const { codeVerifier, codeChallenge } = await oauth.generateCodeVerifierAsync();
    const state = randomString(32);
    const nonce = randomString(32);
    req.session.oauth = { state, nonce, verifier: codeVerifier, intent, at: Date.now(), userId: intent === "link" ? req.session.userId : undefined };
    await new Promise((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
    return oauth.generateAuthUrl({
      scope: ["openid", "email", "profile"],
      state, nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      prompt: "select_account",
      access_type: "online",
    });
  }

  /* ---- sign in / sign up with Google ---- */
  r.get("/start", asyncH(async (req, res) => {
    if (!oauth) return failLogin(res, "google_not_configured");
    res.set("Cache-Control", "no-store");
    res.redirect(303, await buildAuthUrl(req, "login"));
  }));

  /* ---- link Google to the signed-in account (state-changing => POST, CSRF-protected by the parent router) ---- */
  r.post("/link", requireAuth(), asyncH(async (req, res) => {
    if (!oauth) return res.status(503).json({ error: { code: "google_not_configured", message: "Google sign-in isn't configured on this server." } });
    if (Date.now() - (req.session.authAt || 0) > RECENT_AUTH_MS) {
      return res.status(403).json({ error: { code: "reauth_required", message: "For your security, please sign in again before linking Google." } });
    }
    res.json({ url: await buildAuthUrl(req, "link") });
  }));

  /* ---- Google redirects back here ---- */
  r.get("/callback", cbLimiter, asyncH(async (req, res) => {
    const pending = req.session?.oauth;
    if (req.session) delete req.session.oauth; // single use
    const fail = (code) => (pending?.intent === "link" ? failLink(res, code) : failLogin(res, code));

    if (!oauth) return failLogin(res, "google_not_configured");
    if (!pending || Date.now() - pending.at > STATE_TTL_MS) return failLogin(res, "google_state");
    if (req.query.error) return fail(req.query.error === "access_denied" ? "google_cancelled" : "google_failed");
    if (typeof req.query.code !== "string" || !safeEqual(req.query.state, pending.state)) return fail("google_state");

    let payload;
    try {
      const { tokens } = await oauth.getToken({ code: req.query.code, codeVerifier: pending.verifier });
      if (!tokens?.id_token) throw new Error("no id_token returned");
      // Verifies signature (Google's JWKS), `iss`, `aud` and `exp`.
      const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
      payload = ticket.getPayload();
    } catch (err) {
      console.error("[google] token exchange/verification failed:", err?.message);
      return fail(NETWORK_CODES.test(String(err?.code ?? err?.cause?.code ?? "")) ? "google_network" : "google_failed");
    }

    // Defence in depth on top of the library checks.
    if (!payload || !ISSUERS.has(payload.iss) || payload.aud !== clientId || !payload.sub
        || !payload.exp || payload.exp * 1000 < Date.now()) return fail("google_failed");
    if (!safeEqual(payload.nonce, pending.nonce)) return fail("google_state");
    if (payload.email_verified !== true || !payload.email) return fail("google_email_unverified");

    const sub = String(payload.sub);
    const email = String(payload.email).trim().toLowerCase();
    const name = String(payload.name || email.split("@")[0]).replace(/\p{Cc}/gu, "").trim().slice(0, 100) || "EduSphere learner";

    /* ----- link intent ----- */
    if (pending.intent === "link") {
      if (!req.session.userId || req.session.userId !== pending.userId) return failLink(res, "google_state");
      try {
        const result = await withTransaction(pool, async (c) => {
          const { rows: [existing] } = await c.query(
            "select user_id from auth_identities where provider = 'google' and provider_user_id = $1", [sub]);
          if (existing) return String(existing.user_id) === String(pending.userId) ? "already" : "in_use";
          await c.query(
            "insert into auth_identities (user_id, provider, provider_user_id, email, last_login_at) values ($1, 'google', $2, $3, now())",
            [pending.userId, sub, email]);
          // Google just proved control of this address; if it is the account's email, mark it verified.
          await c.query(
            "update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1 and lower(email) = $2",
            [pending.userId, email]);
          return "linked";
        });
        if (result === "in_use") return failLink(res, "google_in_use");
        return res.redirect(303, "/dashboard?linked=google");
      } catch (err) {
        if (isUniqueViolation(err)) return failLink(res, "google_already_linked");
        throw err;
      }
    }

    /* ----- login / sign-up intent ----- */
    let outcome;
    for (let attempt = 0; attempt < 2 && !outcome; attempt++) {
      try {
        outcome = await withTransaction(pool, async (c) => {
          const { rows: [known] } = await c.query(
            `select user_id from auth_identities where provider = 'google' and provider_user_id = $1`, [sub]);
          if (known) {
            await c.query(
              "update auth_identities set last_login_at = now(), email = $2 where provider = 'google' and provider_user_id = $1",
              [sub, email]);
            return { userId: known.user_id };
          }
          // A different account already owns this email: do NOT merge automatically.
          const { rows: [sameEmail] } = await c.query("select id from users where lower(email) = $1", [email]);
          if (sameEmail) return { conflict: true };
          const { rows: [u] } = await c.query(
            "insert into users (email, name, email_verified_at) values ($1, $2, now()) returning id", [email, name]);
          await c.query(
            "insert into auth_identities (user_id, provider, provider_user_id, email, last_login_at) values ($1, 'google', $2, $3, now())",
            [u.id, sub, email]);
          return { userId: u.id };
        });
      } catch (err) {
        // Two simultaneous first-time callbacks: the loser hits a unique constraint, then finds the winner's rows.
        if (!(isUniqueViolation(err) && attempt === 0)) throw err;
      }
    }
    if (!outcome) return failLogin(res, "google_failed");
    if (outcome.conflict) return failLogin(res, "google_email_exists");

    await startSession(req, { userId: outcome.userId, remember: false, config });
    res.redirect(303, config.postLoginPath);
  }));

  return r;
}
