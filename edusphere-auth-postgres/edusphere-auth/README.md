# EduSphere authentication — PostgreSQL edition

Node 20+ · Express 5 · `pg` · Argon2id · Google OpenID Connect · PostgreSQL sessions. No Firebase.

## What you get
| Feature | How it works |
|---|---|
| Create account | name, email, password + confirm, strength meter. Validated in the browser **and** on the server (zod). User row + verification token are inserted in one transaction. |
| Passwords | Argon2id (OWASP params), stored as a PHC string; a DB `CHECK` rejects anything that isn't Argon2id. Hashes upgrade automatically if parameters change. |
| Sign in / out | Generic error ("Incorrect email or password") for unknown email *and* wrong password, same timing (dummy hash). Logout destroys the session row. |
| Sessions | `express-session` + `connect-pg-simple` (table `session`). HttpOnly, `SameSite=Lax`, `Secure` + `__Host-` prefix in production, regenerated on login, idle timeout, "Remember me" = 30 days. |
| Continue with Google | Server-side **authorization-code flow + PKCE**. The ID token is verified with `google-auth-library` (signature, issuer, audience, expiry) plus nonce and `email_verified`. Users are keyed by Google's `sub`. |
| Account linking | Google is **never** merged by email. An existing password account links Google only from its own signed-in session (`POST /api/auth/google/link`, CSRF-protected, recent-login required). |
| Forgot password | Single-use, 1-hour token (only its SHA-256 is stored), emailed link in the URL *fragment*; resetting signs out all other sessions. Same reply whether or not the email exists. |
| Email verification | 24-hour single-use link; Google sign-ups are verified automatically. |
| Protection | CSRF (Origin check + signed double-submit token), rate limits (login per IP+email, register, forgot), Helmet + strict CSP (no inline scripts/styles), 10 KB body limit, parameterized SQL only. |
| Background | Photo animated by a WebGL shader: crown sways around the trunk, leaf flutter, rippling reflection, pulsing horizon glow. Trunk/roots/sky stay still. Falls back to the static photo without WebGL, and stays static with `prefers-reduced-motion`. |

## Run it
```bash
cp .env.example .env        # fill in DATABASE_URL, SESSION_SECRET, GOOGLE_*, SMTP_*
npm install
npm run migrate             # safe, additive; re-running does nothing
npm start                   # http://localhost:3000
npm test                    # needs a throwaway PostgreSQL (see "Tests")
npm run lint
```
Without `SMTP_HOST` in development, verification/reset emails are printed in the server console.

## Google Cloud setup (you must do this)
1. Google Cloud Console → **APIs & Services → OAuth consent screen**: configure it (scopes: `openid`, `email`, `profile`).
2. **Credentials → Create credentials → OAuth client ID → Web application**.
3. **Authorized redirect URIs**: add `<APP_BASE_URL>/api/auth/google/callback` exactly (e.g. `http://localhost:3000/api/auth/google/callback` and your production https URL).
4. Put the client ID/secret in `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`). Never in frontend code.
5. While the consent screen is in "Testing" mode, add your Google account under *Test users*.

## Using your EXISTING project and database
This code is a complete, working reference. I couldn't see your project, so **review before running against production**:
- `migrations/001_auth_schema.sql` is additive: if a `users` table exists it only `ADD COLUMN IF NOT EXISTS` (`name`, `password_hash`, `email_verified_at`, timestamps) and creates `auth_identities`, `email_tokens`, `session`. Foreign keys follow your `users.id` type (uuid or integer). Nothing is dropped, truncated or rewritten.
- It creates a unique index on `lower(email)`. If your data already contains emails differing only by case, the migration will fail safely (it runs in a transaction) — clean those up first.
- If your table stores a hash in a different column (e.g. `password`), either migrate it to `password_hash` or adapt the queries in `src/routes/auth.js`. Existing bcrypt hashes will **not** verify with this code (Argon2id only) — add a bcrypt fallback + rehash-on-login if you have such users.
- **Back up and run the migration on a copy first.**
- If you already have an auth system, don't run two: move the pieces you want (e.g. `routes/google.js`) behind your existing session mechanism.

## Layout
```
migrations/     SQL migrations (run in name order, tracked in schema_migrations)
src/            server (config, db, security, routes, session, mailer)
public/         login/register page, tree animation (js/tree.js), dashboard script
views/          protected dashboard.html — replace with your real dashboard
test/           integration tests against a real PostgreSQL
```

## Tests
`npm test` runs 27 integration tests against a **real PostgreSQL** (it drops/creates its own `edusphere_test_*` databases using `TEST_ADMIN_DATABASE_URL`, default `postgres://postgres:testpw@localhost:54329/postgres`). Never point that at a database you care about.
Google's two network calls (token exchange and ID-token verification) are replaced by a fake **in tests only**; the authorization URL, PKCE, state, nonce, linking and database logic are exercised for real. A real Google round-trip has to be verified by you with your own credentials.

## Known limits / next steps
- Rate limits use in-memory counters: with several server instances, switch to a shared store (e.g. Redis).
- Registration reports "email already exists" (clear UX, rate-limited) — this reveals which emails have accounts. For stricter privacy, return a generic "check your email" instead.
- No Google *unlink* and no 2FA yet. `terms.html` / `privacy.html` are placeholder links.
