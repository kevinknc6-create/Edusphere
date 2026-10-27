// Thin client for the EduSphere auth API. No secrets live here: the browser only ever holds a
// CSRF token and the HttpOnly session cookie that the server manages.

export class ApiError extends Error {
  constructor(code, message, fields, status) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.fields = fields || {};
    this.status = status;
  }
}

let csrfToken = null;

async function loadCsrf() {
  const res = await fetch("/api/auth/csrf", { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) throw new ApiError("network", "Couldn't reach EduSphere. Check your connection and try again.", {}, res.status);
  csrfToken = (await res.json()).csrfToken;
}

/**
 * api("/login", { method: "POST", body })  →  parsed JSON, or throws ApiError.
 * A stale CSRF token is refreshed and the request retried once.
 */
export async function api(path, { method = "GET", body } = {}, retried = false) {
  const headers = { Accept: "application/json" };
  if (method !== "GET") {
    if (!csrfToken) await loadCsrf().catch((e) => { throw e; });
    headers["Content-Type"] = "application/json";
    headers["X-CSRF-Token"] = csrfToken;
  }

  let res;
  try {
    res = await fetch(`/api/auth${path}`, {
      method, headers, credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("network", "Couldn't reach EduSphere. Check your connection and try again.");
  }

  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }

  if (res.status === 403 && data?.error?.code === "csrf" && !retried) {
    csrfToken = null;
    return api(path, { method, body }, true);
  }
  if (!res.ok) {
    const e = data?.error || {};
    throw new ApiError(e.code || "server_error", e.message || "Something went wrong. Please try again.", e.fields, res.status);
  }
  return data;
}
