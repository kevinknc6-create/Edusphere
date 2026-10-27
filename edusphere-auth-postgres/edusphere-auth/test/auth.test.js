import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import argon2 from "argon2";
import { startApp, waitFor, tokenFromMail } from "./helpers.js";

let ctx;
before(async () => { ctx = await startApp({ dbName: "edusphere_test_auth" }); });
after(async () => { await ctx.close(); });

const good = (over = {}) => ({ name: "Ada Lovelace", email: "ada@school.edu", password: "Analytical1", confirmPassword: "Analytical1", ...over });

describe("migrations & constraints", () => {
  test("running migrations twice is a no-op", async () => {
    const { migrate } = await import("../src/db/migrate.js");
    const applied = await migrate(ctx.pool, { log: () => {} });
    assert.deepEqual(applied, []);
  });

  test("migration is additive on a pre-existing users table (data preserved)", async () => {
    const { freshDatabase } = await import("./helpers.js");
    const pg = (await import("pg")).default;
    const { migrate } = await import("../src/db/migrate.js");
    const url = await freshDatabase("edusphere_test_legacy");
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    await c.query("create table users (id serial primary key, email text not null, bio text)");
    await c.query("insert into users (email, bio) values ('old@school.edu', 'keep me')");
    const pool = new pg.Pool({ connectionString: url });
    await migrate(pool, { log: () => {} });
    const { rows } = await c.query("select email, bio, password_hash from users");
    assert.deepEqual(rows, [{ email: "old@school.edu", bio: "keep me", password_hash: null }]);
    // identities follow the integer id type of the existing table
    const t = await c.query("select data_type from information_schema.columns where table_name='auth_identities' and column_name='user_id'");
    assert.equal(t.rows[0].data_type, "integer");
    await pool.end(); await c.end();
  });

  test("DB enforces case-insensitive unique email, unique (provider, sub), argon2id-only hashes", async () => {
    await ctx.pool.query("insert into users (email, name) values ('Dup@x.com', 'A')");
    await assert.rejects(ctx.pool.query("insert into users (email, name) values ('dup@X.com', 'B')"), { code: "23505" });
    const { rows: [u] } = await ctx.pool.query("select id from users where email = 'Dup@x.com'");
    await ctx.pool.query("insert into auth_identities (user_id, provider, provider_user_id) values ($1, 'google', 'sub-dup')", [u.id]);
    await ctx.pool.query("insert into users (email, name) values ('other@x.com', 'C')");
    const { rows: [o] } = await ctx.pool.query("select id from users where email = 'other@x.com'");
    await assert.rejects(ctx.pool.query("insert into auth_identities (user_id, provider, provider_user_id) values ($1, 'google', 'sub-dup')", [o.id]), { code: "23505" });
    await assert.rejects(ctx.pool.query("update users set password_hash = 'plaintext-password' where id = $1", [o.id]), { code: "23514" });
    await ctx.pool.query("delete from users where email in ('Dup@x.com','other@x.com')");
  });
});

describe("registration", () => {
  test("creates a user with an Argon2id hash, a session cookie and a verification email", async () => {
    const c = ctx.client();
    const { status, data } = await c.post("/api/auth/register", good());
    assert.equal(status, 201);
    assert.equal(data.redirect, "/dashboard");

    const { rows: [u] } = await ctx.pool.query("select * from users where email = 'ada@school.edu'");
    assert.ok(u.password_hash.startsWith("$argon2id$"), "hash is argon2id");
    assert.ok(!u.password_hash.includes("Analytical1"), "no plaintext");
    assert.equal(await argon2.verify(u.password_hash, "Analytical1"), true);
    assert.equal(u.email_verified_at, null);

    const sid = c.lastSetCookies["edusphere.sid"];
    assert.match(sid, /HttpOnly/i);
    assert.match(sid, /SameSite=Lax/i);
    assert.doesNotMatch(sid, /Expires|Max-Age/i, "browser-session cookie without Remember me");

    const mail = await waitFor(() => ctx.mailer.outbox.find((m) => m.to === "ada@school.edu"));
    const token = tokenFromMail(mail, "verify-email");
    const { rows: [t] } = await ctx.pool.query("select token_hash from email_tokens where user_id = $1", [u.id]);
    assert.notEqual(t.token_hash, token, "raw token is not stored");

    // verify
    const v = await c.post("/api/auth/verify-email", { token });
    assert.equal(v.status, 200);
    assert.equal((await c.json("/api/auth/me")).data.user.emailVerified, true);
    assert.equal((await c.post("/api/auth/verify-email", { token })).status, 400, "token is single-use");
  });

  test("validates input on the server with per-field messages", async () => {
    const c = ctx.client();
    const r = await c.post("/api/auth/register", { name: "A", email: "nope", password: "short", confirmPassword: "different" });
    assert.equal(r.status, 400);
    assert.ok(r.data.error.fields.name && r.data.error.fields.email && r.data.error.fields.password);
    const m = await c.post("/api/auth/register", good({ email: "mm@school.edu", confirmPassword: "Nope12345" }));
    assert.equal(m.data.error.fields.confirmPassword, "Passwords do not match.");
    const n = await c.post("/api/auth/register", good({ email: "nn@school.edu", password: "onlyletters", confirmPassword: "onlyletters" }));
    assert.match(n.data.error.fields.password, /number/);
    assert.equal((await ctx.pool.query("select 1 from users where email in ('mm@school.edu','nn@school.edu')")).rowCount, 0);
  });

  test("duplicate email (any case) → 409, nothing extra inserted", async () => {
    const c = ctx.client();
    const r = await c.post("/api/auth/register", good({ email: "ADA@School.edu", name: "Impostor" }));
    assert.equal(r.status, 409);
    assert.equal(r.data.error.code, "email_taken");
    assert.equal((await ctx.pool.query("select 1 from users where lower(email) = 'ada@school.edu'")).rowCount, 1);
  });

  test("simultaneous registrations of one email create exactly one account", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () =>
      ctx.client().post("/api/auth/register", good({ email: "race@school.edu" }))));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 5);
    assert.equal((await ctx.pool.query("select 1 from users where email = 'race@school.edu'")).rowCount, 1);
    assert.equal((await ctx.pool.query("select 1 from email_tokens t join users u on u.id=t.user_id where u.email='race@school.edu'")).rowCount, 1);
  });

  test("SQL-injection style input is stored inertly / rejected", async () => {
    const c = ctx.client();
    const r = await c.post("/api/auth/register", good({ email: "x@y.com", name: "Robert'); DROP TABLE users;--", password: "Pass1234'; --", confirmPassword: "Pass1234'; --" }));
    assert.equal(r.status, 201);
    const { rows: [u] } = await ctx.pool.query("select name from users where email = 'x@y.com'");
    assert.equal(u.name, "Robert'); DROP TABLE users;--");
    assert.equal((await c.post("/api/auth/login", { email: "x@y.com' or '1'='1", password: "x" })).status, 400);
  });
});

describe("login, sessions, protected routes", () => {
  test("wrong password and unknown email give the same generic response", async () => {
    const c = ctx.client();
    const a = await c.post("/api/auth/login", { email: "ada@school.edu", password: "WrongPass1" });
    const b = await c.post("/api/auth/login", { email: "ghost@school.edu", password: "WrongPass1" });
    assert.equal(a.status, 401); assert.equal(b.status, 401);
    assert.deepEqual(a.data, b.data);
    assert.equal(c.jar.has("edusphere.sid"), false, "no session on failure");
  });

  test("/dashboard and /me are protected; login → access; logout invalidates the session server-side", async () => {
    const anon = ctx.client();
    const d = await anon.raw("/dashboard");
    assert.equal(d.status, 303); assert.equal(d.headers.get("location"), "/#signin");
    assert.equal((await anon.json("/api/auth/me")).status, 401);

    const c = ctx.client();
    const l = await c.post("/api/auth/login", { email: "Ada@School.edu", password: "Analytical1" });
    assert.equal(l.status, 200);
    assert.equal((await c.raw("/dashboard")).status, 200);
    const me = await c.json("/api/auth/me");
    assert.equal(me.data.user.email, "ada@school.edu");
    assert.equal(me.data.user.password_hash, undefined);

    const stolen = c.cookieHeader(); // copy of the cookie, as an attacker might hold
    assert.equal((await c.post("/api/auth/logout")).status, 200);
    assert.equal((await c.json("/api/auth/me")).status, 401);
    const replay = await fetch(ctx.base + "/api/auth/me", { headers: { cookie: stolen } });
    assert.equal(replay.status, 401, "old cookie no longer works after logout");
  });

  test("session id is regenerated on login (no fixation) and Remember me sets a persistent cookie", async () => {
    const c = ctx.client();
    c.jar.set("edusphere.sid", "s%3Aattacker-chosen.sig");
    const before = c.jar.get("edusphere.sid");
    await c.post("/api/auth/login", { email: "ada@school.edu", password: "Analytical1", remember: true });
    assert.notEqual(c.jar.get("edusphere.sid"), before);
    assert.match(c.lastSetCookies["edusphere.sid"], /Max-Age=2592000|Expires=/i);
  });

  test("CSRF: missing token, bad token and foreign Origin are all rejected", async () => {
    const c = ctx.client();
    assert.equal((await c.post("/api/auth/login", { email: "ada@school.edu", password: "Analytical1" }, { csrf: false })).status, 403);
    await c.getCsrf();
    assert.equal((await c.post("/api/auth/login", { email: "ada@school.edu", password: "Analytical1" }, { headers: { "x-csrf-token": "forged.token" }, csrf: false })).status, 403);
    const evil = await c.raw("/api/auth/login", { method: "POST", body: { email: "ada@school.edu", password: "Analytical1" }, headers: { origin: "https://evil.example", "x-csrf-token": c.csrf }, origin: false, csrf: false });
    assert.equal(evil.status, 403);
  });

  test("login is rate limited per IP+email", async () => {
    const limited = await startApp({ dbName: "edusphere_test_rl", env: { RATE_LIMIT_LOGIN: "3" } });
    try {
      const c = limited.client();
      const codes = [];
      for (let i = 0; i < 5; i++) codes.push((await c.post("/api/auth/login", { email: "who@school.edu", password: "WrongPass1" })).status);
      assert.deepEqual(codes, [401, 401, 401, 429, 429]);
    } finally { await limited.close(); }
  });
});

describe("password reset", () => {
  test("forgot → reset: generic reply, single-use token, new password works, other sessions revoked", async () => {
    const victim = ctx.client();
    await victim.post("/api/auth/login", { email: "ada@school.edu", password: "Analytical1" });
    assert.equal((await victim.json("/api/auth/me")).status, 200);

    const c = ctx.client();
    const known = await c.post("/api/auth/forgot-password", { email: "ada@school.edu" });
    const unknown = await c.post("/api/auth/forgot-password", { email: "nobody@school.edu" });
    assert.equal(known.status, 202); assert.deepEqual(known.data, unknown.data);

    const mail = await waitFor(() => ctx.mailer.outbox.filter((m) => m.subject.startsWith("Reset")).at(-1));
    assert.equal(ctx.mailer.outbox.filter((m) => m.to === "nobody@school.edu").length, 0);
    const token = tokenFromMail(mail, "new-password");

    const weak = await c.post("/api/auth/reset-password", { token, password: "short", confirmPassword: "short" });
    assert.equal(weak.status, 400);
    const ok = await c.post("/api/auth/reset-password", { token, password: "BrandNew2026", confirmPassword: "BrandNew2026" });
    assert.equal(ok.status, 200);
    assert.equal((await c.post("/api/auth/reset-password", { token, password: "Another2026x", confirmPassword: "Another2026x" })).status, 400, "single use");

    assert.equal((await victim.json("/api/auth/me")).status, 401, "old session revoked");
    assert.equal((await ctx.client().post("/api/auth/login", { email: "ada@school.edu", password: "Analytical1" })).status, 401);
    assert.equal((await ctx.client().post("/api/auth/login", { email: "ada@school.edu", password: "BrandNew2026" })).status, 200);
  });

  test("expired reset token is refused", async () => {
    const c = ctx.client();
    await c.post("/api/auth/forgot-password", { email: "ada@school.edu" });
    const mail = await waitFor(() => ctx.mailer.outbox.filter((m) => m.subject.startsWith("Reset")).at(-1));
    await ctx.pool.query("update email_tokens set expires_at = now() - interval '1 minute' where purpose = 'reset_password'");
    const r = await c.post("/api/auth/reset-password", { token: tokenFromMail(mail, "new-password"), password: "Whatever2026", confirmPassword: "Whatever2026" });
    assert.equal(r.status, 400);
  });
});

test("security headers and static pages", async () => {
  const res = await fetch(ctx.base + "/healthz");
  assert.equal(res.status, 200);
  const csp = res.headers.get("content-security-policy");
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(res.headers.get("x-powered-by"), null);
});
