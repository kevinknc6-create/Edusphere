import pg from "pg";
import { OAuth2Client } from "google-auth-library";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";
import { createApp } from "../src/app.js";
import { createMailer } from "../src/mailer.js";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL || "postgres://postgres:testpw@localhost:54329/postgres";

export async function freshDatabase(name) {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  return ADMIN_URL.replace(/\/[^/]*$/, `/${name}`);
}

/** Fake Google client: real URL generation + PKCE, but token exchange/verification are scripted. */
export class FakeGoogle extends OAuth2Client {
  constructor(opts) { super(opts); this.next = null; this.calls = []; }
  async getToken(args) { this.calls.push(args); if (this.next?.getTokenError) throw this.next.getTokenError; return { tokens: { id_token: `fake.${args.code}` } }; }
  async verifyIdToken({ idToken, audience }) {
    if (this.next?.verifyError) throw this.next.verifyError;
    const perCode = this.byCode?.[idToken.slice(5)]; // lets concurrent requests each get their own scripted identity
    const payload = { iss: "https://accounts.google.com", aud: audience, exp: Math.floor(Date.now() / 1000) + 600, ...(perCode ?? this.next?.payload) };
    return { getPayload: () => payload };
  }
}

export async function startApp({ dbName, env = {} } = {}) {
  const databaseUrl = await freshDatabase(dbName);
  const config = loadConfig({
    NODE_ENV: "test", DATABASE_URL: databaseUrl, SESSION_SECRET: "x".repeat(48), APP_BASE_URL: "http://localhost:3999",
    GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "test-secret",
    RATE_LIMIT_LOGIN: "1000", RATE_LIMIT_REGISTER: "1000", RATE_LIMIT_FORGOT: "1000", RATE_LIMIT_GENERAL: "10000",
    ...env,
  });
  const pool = createPool(config);
  await migrate(pool, { log: () => {} });
  const google = new FakeGoogle({ clientId: config.google.clientId, clientSecret: config.google.clientSecret, redirectUri: config.google.redirectUri });
  const mailer = createMailer(config);
  const originalLog = console.log; // keep test output readable
  console.log = () => {};
  const app = createApp({ config, pool, googleClient: google, mailer });
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  console.log = originalLog;
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    config, pool, google, mailer, base,
    client: () => new Client(base, config),
    async close() { await new Promise((r) => server.close(r)); await pool.end(); },
  };
}

/** Minimal browser-like client: keeps cookies, sends Origin + CSRF header. */
export class Client {
  constructor(base, config) { this.base = base; this.origin = new URL(config.baseUrl).origin; this.jar = new Map(); this.csrf = null; }
  cookieHeader() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
  store(res) {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const i = pair.indexOf("=");
      const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
      if (v === "" || /max-age=0/i.test(attrs.join(";")) || /expires=Thu, 01 Jan 1970/i.test(attrs.join(";"))) this.jar.delete(k); else this.jar.set(k, decodeURIComponent(v));
      (this.lastSetCookies ??= {})[k] = c;
    }
  }
  async raw(path, { method = "GET", body, headers = {}, csrf = true, origin = true } = {}) {
    const h = { ...headers };
    if (method !== "GET") {
      if (origin) h.origin = this.origin;
      if (body !== undefined) h["content-type"] = "application/json";
      if (csrf) { if (!this.csrf) await this.getCsrf(); h["x-csrf-token"] = this.csrf; }
    }
    if (this.jar.size) h.cookie = this.cookieHeader(); // after any CSRF fetch, so the new cookie is sent
    const res = await fetch(this.base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    this.store(res);
    return res;
  }
  async getCsrf() {
    const res = await this.raw("/api/auth/csrf");
    this.csrf = (await res.json()).csrfToken;
  }
  async json(path, opts) { const res = await this.raw(path, opts); let data = null; try { data = await res.json(); } catch { /* none */ } return { status: res.status, data, res }; }
  post(path, body, opts) { return this.json(path, { method: "POST", body: body ?? {}, ...opts }); }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(fn, ms = 3000) {
  const t = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t > ms) throw new Error("waitFor timeout"); await sleep(25); }
}
export const tokenFromMail = (mail, key) => new RegExp(`#${key}=([\\w-]+)`).exec(mail.text)[1];
