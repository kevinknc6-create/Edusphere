import crypto from "node:crypto";
import { safeEqual } from "./tokens.js";

/**
 * CSRF protection for the JSON API, in two independent layers:
 *  1. Origin check: unsafe requests must come from our own origin (Origin header, or
 *     Sec-Fetch-Site: same-origin as a fallback). Cross-site pages cannot forge this.
 *  2. Signed double-submit token: the client reads a token from GET /api/auth/csrf and sends it
 *     in X-CSRF-Token; it must equal the HttpOnly cookie and carry a valid HMAC signature.
 * Combined with SameSite=Lax session cookies this covers login-CSRF as well.
 */
export function createCsrf({ secret, baseUrl, isProd }) {
  const key = crypto.createHmac("sha256", secret).update("edusphere-csrf-v1").digest();
  const cookieName = isProd ? "__Host-edusphere.csrf" : "edusphere.csrf";
  const origin = new URL(baseUrl).origin;

  const sign = (nonce) => crypto.createHmac("sha256", key).update(nonce).digest("base64url");
  const make = () => {
    const nonce = crypto.randomBytes(24).toString("base64url");
    return `${nonce}.${sign(nonce)}`;
  };
  const wellFormed = (token) => {
    if (typeof token !== "string") return false;
    const [nonce, sig] = token.split(".");
    return Boolean(nonce && sig) && safeEqual(sig, sign(nonce));
  };

  const sameOrigin = (req) => {
    const o = req.get("origin");
    if (o) return o === origin;
    const site = req.get("sec-fetch-site");
    return site === "same-origin";
  };

  return {
    cookieName,

    /** GET handler: issues a fresh token. */
    issue(_req, res) {
      const token = make();
      res.cookie(cookieName, token, {
        httpOnly: true, sameSite: "lax", secure: isProd, path: "/", maxAge: 12 * 36e5,
      });
      res.set("Cache-Control", "no-store");
      res.json({ csrfToken: token });
    },

    /** Middleware for POST/PUT/PATCH/DELETE. */
    protect(req, res, next) {
      if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
      const fail = (message) => res.status(403).json({ error: { code: "csrf", message } });
      if (!sameOrigin(req)) return fail("Request blocked for your security. Please reload the page and try again.");
      const header = req.get("x-csrf-token");
      const cookie = req.cookies?.[cookieName];
      if (!header || !cookie || !safeEqual(header, cookie) || !wellFormed(header)) {
        return fail("Your session expired. Please try again.");
      }
      next();
    },
  };
}
