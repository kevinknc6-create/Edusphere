import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startApp } from "./helpers.js";

let ctx;
before(async () => { ctx = await startApp({ dbName: "edusphere_test_google" }); });
after(async () => { await ctx.close(); });

let counter = 0;
const profile = (over = {}) => ({ sub: `g-sub-${++counter}`, email: `g${counter}@gmail.com`, email_verified: true, name: "Grace Hopper", ...over });

/** Drives /start → (Google) → /callback the way a browser would. */
async function oauth(c, payload, { query = {}, mutateState } = {}) {
  const start = await c.raw("/api/auth/google/start");
  assert.equal(start.status, 303);
  const url = new URL(start.headers.get("location"));
  const params = Object.fromEntries(url.searchParams);
  ctx.google.next = { payload: { nonce: params.nonce, ...payload } };
  const state = mutateState ? mutateState(params.state) : params.state;
  const cb = await c.raw("/api/auth/google/callback?" + new URLSearchParams({ code: "auth-code", state, ...query }));
  return { url, params, cb, location: cb.headers.get("location") };
}

describe("authorization request", () => {
  test("redirects to Google with PKCE (S256), state, nonce, openid scopes and our client id", async () => {
    const { url, params } = await oauth(ctx.client(), profile());
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(params.client_id, ctx.config.google.clientId);
    assert.equal(params.response_type, "code");
    assert.equal(params.code_challenge_method, "S256");
    assert.ok(params.code_challenge.length >= 43);
    assert.ok(params.state.length >= 32 && params.nonce.length >= 32);
    assert.match(params.scope, /openid/); assert.match(params.scope, /email/);
    assert.equal(params.redirect_uri, `${ctx.config.baseUrl}/api/auth/google/callback`);
    assert.equal(ctx.google.calls.at(-1).codeVerifier.length >= 43, true, "verifier sent on token exchange");
  });
});

describe("sign in / sign up with Google", () => {
  test("new Google user: account + identity created atomically, verified email, session started", async () => {
    const c = ctx.client();
    const p = profile();
    const { location } = await oauth(c, p);
    assert.equal(location, "/dashboard");
    const { rows } = await ctx.pool.query(
      `select u.email, u.name, u.password_hash, u.email_verified_at, i.provider_user_id
         from users u join auth_identities i on i.user_id = u.id where i.provider_user_id = $1`, [p.sub]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, p.email); assert.equal(rows[0].password_hash, null); assert.ok(rows[0].email_verified_at);
    const me = await c.json("/api/auth/me");
    assert.deepEqual(me.data.user.providers, ["google"]);
    assert.equal(me.data.user.hasPassword, false);
  });

  test("returning Google user (same sub) signs into the same account, even if their Google email changed", async () => {
    const p = profile();
    await oauth(ctx.client(), p);
    const c = ctx.client();
    const { location } = await oauth(c, { ...p, email: "renamed@gmail.com" });
    assert.equal(location, "/dashboard");
    assert.equal((await ctx.pool.query("select 1 from auth_identities where provider_user_id = $1", [p.sub])).rowCount, 1);
    assert.equal((await ctx.pool.query("select 1 from users where email = 'renamed@gmail.com'")).rowCount, 0, "no second user");
  });

  test("never auto-merges: a password account with the same email is left alone", async () => {
    const owner = ctx.client();
    await owner.post("/api/auth/register", { name: "Pat", email: "pat@school.edu", password: "Password123", confirmPassword: "Password123" });
    const c = ctx.client();
    const p = profile({ email: "pat@school.edu" });
    const { location } = await oauth(c, p);
    assert.equal(location, "/?auth_error=google_email_exists#signin");
    assert.equal((await ctx.pool.query("select 1 from auth_identities where provider_user_id = $1", [p.sub])).rowCount, 0);
    assert.equal((await c.json("/api/auth/me")).status, 401, "no session was created");
  });

  test("verified linking: signed-in owner links Google, then Google sign-in reaches the same account", async () => {
    const c = ctx.client();
    await c.post("/api/auth/login", { email: "pat@school.edu", password: "Password123" });
    const p = profile({ email: "pat.private@gmail.com" });
    const link = await c.post("/api/auth/google/link");
    assert.equal(link.status, 200);
    const params = Object.fromEntries(new URL(link.data.url).searchParams);
    ctx.google.next = { payload: { nonce: params.nonce, ...p } };
    const cb = await c.raw("/api/auth/google/callback?" + new URLSearchParams({ code: "c", state: params.state }));
    assert.equal(cb.headers.get("location"), "/dashboard?linked=google");

    const { location } = await oauth(ctx.client(), p);
    assert.equal(location, "/dashboard");
    const { rows } = await ctx.pool.query("select count(*)::int n from users where email in ('pat@school.edu','pat.private@gmail.com')");
    assert.equal(rows[0].n, 1, "still one user");
    assert.deepEqual((await c.json("/api/auth/me")).data.user.providers, ["google"]);
  });

  test("linking requires a session, CSRF, and a recent sign-in; a Google identity cannot be claimed twice", async () => {
    assert.equal((await ctx.client().post("/api/auth/google/link")).status, 401);

    const c = ctx.client();
    await c.post("/api/auth/register", { name: "Lee", email: "lee@school.edu", password: "Password123", confirmPassword: "Password123" });
    assert.equal((await c.post("/api/auth/google/link", {}, { csrf: false })).status, 403);

    // someone else's Google account
    const taken = profile();
    await oauth(ctx.client(), taken);
    const link = await c.post("/api/auth/google/link");
    const params = Object.fromEntries(new URL(link.data.url).searchParams);
    ctx.google.next = { payload: { nonce: params.nonce, ...taken } };
    const cb = await c.raw("/api/auth/google/callback?" + new URLSearchParams({ code: "c", state: params.state }));
    assert.equal(cb.headers.get("location"), "/dashboard?link_error=google_in_use");

    // stale login → must re-authenticate
    const store = await ctx.pool.query("select sid, sess from session where sess->>'userId' = (select id::text from users where email='lee@school.edu')");
    const sess = store.rows[0].sess; sess.authAt = Date.now() - 3600_000;
    await ctx.pool.query("update session set sess = $2 where sid = $1", [store.rows[0].sid, JSON.stringify(sess)]);
    const stale = await c.post("/api/auth/google/link");
    assert.equal(stale.status, 403); assert.equal(stale.data.error.code, "reauth_required");
  });

  test("simultaneous first-time callbacks for one Google account create exactly one user", async () => {
    const p = profile();
    const clients = Array.from({ length: 5 }, () => ctx.client());
    const starts = await Promise.all(clients.map(async (c) => {
      const s = await c.raw("/api/auth/google/start");
      return Object.fromEntries(new URL(s.headers.get("location")).searchParams);
    }));
    ctx.google.byCode = Object.fromEntries(starts.map((st, k) => [`race${k}`, { ...p, nonce: st.nonce }]));
    const results = await Promise.all(clients.map((c, k) =>
      c.raw("/api/auth/google/callback?" + new URLSearchParams({ code: `race${k}`, state: starts[k].state }))));
    ctx.google.byCode = null;
    assert.ok(results.every((r) => r.headers.get("location") === "/dashboard"), results.map((r) => r.headers.get("location")).join());
    assert.equal((await ctx.pool.query("select 1 from users where email = $1", [p.email])).rowCount, 1);
    assert.equal((await ctx.pool.query("select 1 from auth_identities where provider_user_id = $1", [p.sub])).rowCount, 1);
  });
});

describe("rejections", () => {
  const noUserFor = async (sub) => assert.equal((await ctx.pool.query("select 1 from auth_identities where provider_user_id = $1", [sub])).rowCount, 0);

  test("forged / replayed / missing state", async () => {
    const p = profile();
    assert.equal((await oauth(ctx.client(), p, { mutateState: () => "forged-state" })).location, "/?auth_error=google_state#signin");
    // callback with no prior /start
    const bare = await ctx.client().raw("/api/auth/google/callback?code=c&state=s");
    assert.equal(bare.headers.get("location"), "/?auth_error=google_state#signin");
    await noUserFor(p.sub);
    // replay: a state can be used only once
    const c = ctx.client();
    const first = await oauth(c, p);
    assert.equal(first.location, "/dashboard");
    const replay = await c.raw("/api/auth/google/callback?" + new URLSearchParams({ code: "c", state: first.params.state }));
    assert.equal(replay.headers.get("location"), "/?auth_error=google_state#signin");
  });

  test("nonce mismatch, unverified email, wrong audience, wrong issuer, expired token", async () => {
    for (const [bad, expected] of [
      [{ nonce: "attacker-nonce" }, "google_state"],
      [{ email_verified: false }, "google_email_unverified"],
      [{ aud: "someone-elses-client-id" }, "google_failed"],
      [{ iss: "https://evil.example" }, "google_failed"],
      [{ exp: Math.floor(Date.now() / 1000) - 10 }, "google_failed"],
    ]) {
      const p = profile();
      const c = ctx.client();
      const s = await c.raw("/api/auth/google/start");
      const params = Object.fromEntries(new URL(s.headers.get("location")).searchParams);
      ctx.google.next = { payload: { nonce: params.nonce, ...p, ...bad } };
      const cb = await c.raw("/api/auth/google/callback?" + new URLSearchParams({ code: "c", state: params.state }));
      assert.equal(cb.headers.get("location"), `/?auth_error=${expected}#signin`, JSON.stringify(bad));
      await noUserFor(p.sub);
    }
  });

  test("user cancels, OAuth error, token verification failure, network failure", async () => {
    const c1 = ctx.client(); await c1.raw("/api/auth/google/start");
    const cancelled = await c1.raw("/api/auth/google/callback?error=access_denied&state=x");
    assert.equal(cancelled.headers.get("location"), "/?auth_error=google_cancelled#signin");

    const run = async (next) => {
      const c = ctx.client();
      const s = await c.raw("/api/auth/google/start");
      const params = Object.fromEntries(new URL(s.headers.get("location")).searchParams);
      ctx.google.next = next;
      return (await c.raw("/api/auth/google/callback?" + new URLSearchParams({ code: "c", state: params.state }))).headers.get("location");
    };
    const quiet = console.error; console.error = () => {};
    try {
      assert.equal(await run({ verifyError: new Error("Invalid token signature") }), "/?auth_error=google_failed#signin");
      assert.equal(await run({ getTokenError: Object.assign(new Error("invalid_grant"), { code: "400" }) }), "/?auth_error=google_failed#signin");
      assert.equal(await run({ getTokenError: Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }) }), "/?auth_error=google_network#signin");
    } finally { console.error = quiet; }
  });

  test("unconfigured server redirects with a clear error instead of faking anything", async () => {
    const bare = await startApp({ dbName: "edusphere_test_nogoogle", env: { GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" } });
    try {
      const { createApp } = await import("../src/app.js");
      const app = createApp({ config: bare.config, pool: bare.pool });
      const srv = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
      const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/auth/google/start`, { redirect: "manual" });
      assert.equal(res.headers.get("location"), "/?auth_error=google_not_configured#signin");
      await new Promise((r) => srv.close(r));
    } finally { await bare.close(); }
  });
});
