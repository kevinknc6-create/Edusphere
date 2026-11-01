/* EduSphere auth adapter
 * ------------------------------------------------------------------
 * This is the ONLY file that talks to your authentication system.
 * The scroll-login UI calls window.EduSphereAuth.signIn / signUp /
 * requestPasswordReset and shows whatever they resolve or throw.
 *
 * It never pretends to succeed: until you point it at your real
 * endpoints, every action throws a clear "not connected" error.
 *
 * Three ways to connect it (pick one):
 *
 *  A) REST/JSON or form endpoints  -> fill in CONFIG below.
 *  B) An SDK your app already uses (Firebase, Supabase, Auth0, NextAuth…)
 *     -> delete the CONFIG block and assign your own functions to
 *        window.EduSphereAuth (see INTEGRATION.md for examples).
 *  C) Server-rendered forms (Laravel, Django, Rails, PHP…)
 *     -> point `url` at the same route your current login form posts to
 *        and set `format: 'form'`.
 *
 * Every function must resolve to { redirectTo?: string, message?: string }
 * on success and THROW an Error (with a user-readable message) on failure.
 */
(function () {
  'use strict';

  const CONFIG = {
    // Send cookies (session auth). Use 'omit' if you authenticate with a bearer token only.
    credentials: 'include',

    // Extra headers on every request, e.g. { 'X-Requested-With': 'XMLHttpRequest' }
    headers: {},

    // Return a CSRF token if your backend needs one (Laravel/Django/Rails), else leave null.
    // Example: () => document.querySelector('meta[name="csrf-token"]')?.content
    csrf: null,
    csrfHeader: 'X-CSRF-Token',

    signIn: {
      url: '/api/auth/login',
      method: 'POST',
      format: 'json',                  // 'json' | 'form'
      // Map the UI's values to the field names your backend expects.
      body: (v) => ({ email: v.email, password: v.password }),
      redirectTo: null,
    },

    signUp: {
      url: '/api/auth/register',
      method: 'POST',
      format: 'json',
      body: (v) => ({ name: v.name, fullName: v.name, email: v.email, password: v.password }),
      redirectTo: null,
    },

    forgot: {
      url: null,                       // e.g. '/api/auth/forgot-password'
      method: 'POST',
      format: 'json',
      body: (v) => ({ email: v.email }),
      // If your app already has a reset PAGE, set this instead and the
      // "Forgot password?" link will simply go there:
      pageUrl: null,                   // e.g. '/forgot-password'
    },

    // Called after a successful sign-in / sign-up. Store a token here if your app
    // keeps one client-side. `data` is the parsed response body (or null).
    onSuccess: async (kind, data) => {
      const token = data?.accessToken || data?.token;
      if (kind === 'signIn' && token && data?.user) {
        const user = data.user;
        window.parent.postMessage({
          type: 'edusphere-auth-success',
          session: {
            accessToken: token,
            user: {
              id: String(user.id),
              email: user.email,
              fullName: user.fullName || user.name || user.email.split('@')[0],
              role: user.role || 'student',
            },
          },
        }, window.location.origin);
      }
    },

    // How to read an error message out of a failed response.
    extractError: (data, res) =>
      (data && (data.message || data.error || (Array.isArray(data.errors) && data.errors[0]?.message))) ||
      (res.status === 401 ? 'Email or password is incorrect.' : null),
  };

  // ------------------------------------------------------------------

  class NotConnected extends Error { }

  async function call(kind, cfg, values) {
    if (!cfg || !cfg.url) {
      throw new NotConnected(
        'The form isn\u2019t connected to EduSphere yet. Set the endpoint in js/auth-adapter.js.'
      );
    }

    const headers = Object.assign({ Accept: 'application/json' }, CONFIG.headers);
    if (CONFIG.csrf) {
      const token = CONFIG.csrf();
      if (token) headers[CONFIG.csrfHeader] = token;
    }

    const payload = cfg.body(values);
    let body;
    if (cfg.format === 'form') {
      body = new URLSearchParams(payload);
      headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    } else {
      body = JSON.stringify(payload);
      headers['Content-Type'] = 'application/json';
    }

    let res;
    try {
      res = await fetch(cfg.url, { method: cfg.method || 'POST', headers, body, credentials: CONFIG.credentials });
    } catch (e) {
      throw new Error('Can\u2019t reach EduSphere. Check your connection and try again.');
    }

    let data = null;
    const type = res.headers.get('content-type') || '';
    if (type.includes('json')) {
      try { data = await res.json(); } catch (e) { data = null; }
    }

    if (!res.ok) {
      throw new Error(CONFIG.extractError(data, res) || 'Something went wrong (' + res.status + '). Try again.');
    }

    if (kind !== 'forgot') await CONFIG.onSuccess(kind, data);
    return { data, redirectTo: (data && data.redirectTo) || cfg.redirectTo || null };
  }

  const adapter = {
    async signIn(values) {
      const r = await call('signIn', CONFIG.signIn, values);
      return { redirectTo: r.redirectTo, message: 'Signed in. Opening your dashboard\u2026' };
    },
    async signUp(values) {
      const r = await call('signUp', CONFIG.signUp, values);
      return { redirectTo: r.redirectTo, message: r.data && r.data.message || 'Account created. Please sign in.' };
    },
    async requestPasswordReset(values) {
      await call('forgot', CONFIG.forgot, values);
      return { message: 'If that email has an account, a reset link is on its way.' };
    },
    forgotPasswordUrl: CONFIG.forgot.pageUrl,
  };

  // Don't clobber an adapter the host app defined itself (option B).
  if (!window.EduSphereAuth) window.EduSphereAuth = adapter;
})();
