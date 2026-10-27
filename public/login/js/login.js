import { api, ApiError } from "./api.js";
import { startTree } from "./tree.js";

const $ = (id) => document.getElementById(id);

const card = document.querySelector(".card");
const forms = { signin: $("login-form"), signup: $("signup-form"), reset: $("reset-form"), newpass: $("newpass-form") };
const tabs = [...document.querySelectorAll(".tabs__tab")];
const alertBox = $("form-alert");
const alertText = $("form-alert-text");
const status = $("status");
const googleBtn = $("google-btn");
const social = $("social");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PASSWORD_MIN = 12;

const COPY = {
  signin: {
    title: "Welcome back.<br><span>Keep growing.</span>",
    text: "Sign in to continue your courses, track your progress, and learn at your own pace.",
    heading: "Sign in", sub: "Enter your details to access your account.", page: "Sign in · EduSphere",
  },
  signup: {
    title: "Start your<br><span>journey.</span>",
    text: "Create your free EduSphere account and begin learning in minutes.",
    heading: "Create your account", sub: "It only takes a minute.", page: "Create account · EduSphere",
  },
  reset: {
    title: "Locked out?<br><span>No problem.</span>",
    text: "Confirm your account details and we'll send you a verification code.",
    heading: "Reset password", sub: "We'll email you a secure verification code.", page: "Reset password · EduSphere",
  },
  newpass: {
    title: "A fresh<br><span>start.</span>",
    text: "Choose a strong new password. You'll be signed out on all other devices.",
    heading: "Choose a new password", sub: "Use at least 12 characters.", page: "New password · EduSphere",
  },
};

const AUTH_ERRORS = {
  google_cancelled: ["info", "Google sign-in was cancelled. You can try again whenever you're ready."],
  google_failed: ["error", "We couldn't verify your Google sign-in. Please try again."],
  google_state: ["error", "That Google sign-in session expired. Please try again."],
  google_network: ["error", "Couldn't reach Google. Check your connection and try again."],
  google_email_unverified: ["error", "Google says that email address isn't verified, so we can't use it."],
  google_email_exists: ["error", "This Google account is already linked to another EduSphere account."],
  google_not_configured: ["info", "Google sign-in isn't set up on this server yet."],
  rate_limited: ["error", "Too many attempts. Please wait a few minutes and try again."],
};

let busy = false;
let mode = "signin";
let resetToken = null; // from the emailed link; kept in memory only, never in the URL
let resetCodeRequested = false;

/* ---------- Alerts & field errors ---------- */
function setFieldError(input, message) {
  const field = input.closest(".field");
  const el = $(`${input.id}-error`);
  if (!el) return;
  if (message) {
    el.textContent = message;
    el.hidden = false;
    field.classList.add("has-error");
    input.setAttribute("aria-invalid", "true");
  } else {
    el.hidden = true;
    el.textContent = "";
    field.classList.remove("has-error");
    input.removeAttribute("aria-invalid");
  }
}

function showAlert(message, kind = "error") {
  alertText.textContent = message;
  alertBox.classList.toggle("is-info", kind === "info");
  alertBox.hidden = false;
}
const hideAlert = () => { alertBox.hidden = true; alertText.textContent = ""; };

function shake() {
  if (reducedMotion.matches) return;
  card.classList.remove("is-shake");
  void card.offsetWidth;
  card.classList.add("is-shake");
}

/* ---------- Busy / button states ---------- */
function setBusy(state, btn) {
  busy = state !== "idle";
  document.querySelectorAll("[data-submit], #google-btn, .tabs__tab, [data-switch]").forEach((el) => { el.disabled = busy; });
  card.toggleAttribute("aria-busy", state === "loading");
  if (btn) {
    btn.dataset.state = state;
    btn.setAttribute("aria-busy", String(state === "loading"));
  }
  status.textContent = state === "loading" ? "Please wait…" : state === "success" ? "Success. Redirecting…" : "";
}

/* ---------- Mode switching ---------- */
function setMode(next, { focus = false, updateHash = true } = {}) {
  if (!forms[next]) next = "signin";
  if (next === "reset" && mode !== "reset") {
    resetCodeRequested = false;
    $("rs-name").closest(".field").hidden = false;
    $("rs-email").closest(".field").hidden = false;
    $("rs-code-field").hidden = true;
    $("rs-code").value = "";
    forms.reset.querySelector("[data-submit] .btn__label").textContent = "Send verification code";
  }
  mode = next;
  const copy = COPY[next];

  card.dataset.mode = next;
  document.title = copy.page;
  $("card-title").textContent = copy.heading;
  $("card-sub").textContent = copy.sub;
  document.querySelector('[data-copy="title"]').innerHTML = copy.title;
  document.querySelector('[data-copy="text"]').textContent = copy.text;

  tabs.forEach((t) => {
    const on = t.dataset.switch === next;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
  });
  Object.entries(forms).forEach(([key, form]) => {
    const on = key === next;
    form.hidden = !on;
    if (on) { form.classList.remove("panel--in"); void form.offsetWidth; form.classList.add("panel--in"); }
  });
  social.hidden = next === "reset" || next === "newpass";

  hideAlert();
  Object.values(forms).forEach((f) => f.querySelectorAll("input").forEach((i) => i.hasAttribute("aria-invalid") && setFieldError(i, "")));
  setPasswordVisible(false);

  if (focus) {
    const first = forms[next].querySelector("input");
    window.setTimeout(() => first && first.focus(), reducedMotion.matches ? 0 : 60);
  }
  if (updateHash && next !== "newpass") {
    const hash = next === "signin" ? "" : `#${next}`;
    if (location.hash !== hash) history.replaceState(null, "", location.pathname + location.search + hash);
  }
}

document.addEventListener("click", (e) => {
  const trigger = e.target.closest("[data-switch]");
  if (trigger && !busy) setMode(trigger.dataset.switch, { focus: true });
});

document.querySelector(".tabs").addEventListener("keydown", (e) => {
  if (busy || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const i = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
  const n = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  e.preventDefault();
  tabs[n].focus();
  setMode(tabs[n].dataset.switch);
});

window.addEventListener("hashchange", () => {
  if (busy) return;
  const m = location.hash.slice(1);
  // Emailed links pasted into a tab that already has this page open
  if (m.startsWith("new-password=") || m.startsWith("verify-email=")) { handleEntry(); return; }
  if ((m === "signup" || m === "reset" || m === "signin" || m === "") && m !== mode) setMode(m || "signin", { updateHash: false });
});

/* ---------- Password visibility ---------- */
function setPasswordVisible(show) {
  document.querySelectorAll(".toggle").forEach((btn) => {
    $(btn.dataset.target).type = show ? "text" : "password";
    btn.setAttribute("aria-pressed", String(show));
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });
}

document.querySelectorAll(".toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = $(btn.dataset.target);
    const show = input.type === "password";
    const start = input.selectionStart, end = input.selectionEnd;
    input.type = show ? "text" : "password";
    btn.setAttribute("aria-pressed", String(show));
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    input.focus();
    try { input.setSelectionRange(start, end); } catch { /* ignore */ }
  });
});

/* ---------- Caps Lock hint ---------- */
["password", "su-password"].forEach((id) => {
  const input = $(id), hint = $(`${id}-caps`);
  const check = (e) => { hint.hidden = !(e.getModifierState && e.getModifierState("CapsLock")); };
  input.addEventListener("keydown", check);
  input.addEventListener("keyup", check);
  input.addEventListener("blur", () => { hint.hidden = true; });
});

/* ---------- Password strength ---------- */
const LEVELS = ["", "Weak", "Fair", "Good", "Strong"];
const problems = (pw) => [
  ...(pw.length < PASSWORD_MIN ? [`at least ${PASSWORD_MIN} characters`] : []),
  ...(/[A-Za-z]/.test(pw) ? [] : ["a letter"]),
  ...(/\d/.test(pw) ? [] : ["a number"]),
];

function strengthLevel(pw) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= PASSWORD_MIN) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  if (problems(pw).length) score = Math.min(score, 1);
  return Math.max(1, Math.min(4, score));
}

function bindMeter(inputId, meterId) {
  const input = $(inputId), meter = $(meterId), text = meter.querySelector(".meter__text");
  const update = () => {
    const pw = input.value, level = strengthLevel(pw), p = problems(pw);
    meter.dataset.level = String(level);
    text.textContent = !pw ? `Use ${PASSWORD_MIN}+ characters with a letter and a number.`
      : p.length ? `Needs ${p.join(", ")}.` : `${LEVELS[level]} password`;
  };
  input.addEventListener("input", update);
  update();
}
bindMeter("su-password", "su-password-help");
bindMeter("np-password", "np-meter");

/* ---------- Client-side validation (the server re-validates everything) ---------- */
let pointerDown = false;
const pendingBlur = [];
document.addEventListener("pointerdown", () => { pointerDown = true; }, true);
const release = () => {
  pointerDown = false;
  // setTimeout lets the click event finish before the layout can change
  window.setTimeout(() => pendingBlur.splice(0).forEach((fn) => fn()), 0);
};
document.addEventListener("pointerup", release, true);
document.addEventListener("pointercancel", release, true);

const emailCheck = (id) => () => {
  const v = $(id).value.trim();
  if (!v) return "Enter your email address.";
  return EMAIL_RE.test(v) ? "" : "Enter a valid email address, like name@school.edu.";
};
const passwordCheck = (id) => () => {
  const v = $(id).value;
  if (!v) return "Create a password.";
  const p = problems(v);
  return p.length ? `Your password needs ${p.join(", ")}.` : "";
};
const confirmCheck = (pwId, id) => () => {
  const v = $(id).value;
  if (!v) return "Confirm your password.";
  return v === $(pwId).value ? "" : "Passwords do not match.";
};

const validators = {
  identifier: emailCheck("identifier"),
  password: () => ($("password").value ? "" : "Enter your password."),
  "su-name": () => ($("su-name").value.trim().length >= 2 ? "" : "Enter your full name."),
  "su-email": emailCheck("su-email"),
  "su-password": passwordCheck("su-password"),
  "su-confirm": confirmCheck("su-password", "su-confirm"),
  "su-terms": () => ($("su-terms").checked ? "" : "Please accept the Terms and Privacy Policy to continue."),
  "rs-name": () => ($("rs-name").value.trim().length >= 2 ? "" : "Enter your full name."),
  "rs-email": emailCheck("rs-email"),
  "rs-code": () => (/^\d{6}$/.test($("rs-code").value.trim()) ? "" : "Enter the 6-digit verification code."),
  "np-password": passwordCheck("np-password"),
  "np-confirm": confirmCheck("np-password", "np-confirm"),
};

function validateForm(form) {
  let firstBad = null;
  form.querySelectorAll("input").forEach((input) => {
    const fn = validators[input.id];
    if (!fn) return;
    if (input.closest(".field")?.hidden) return;
    const msg = fn();
    setFieldError(input, msg);
    if (msg && !firstBad) firstBad = input;
  });
  if (firstBad) firstBad.focus();
  return !firstBad;
}

Object.values(forms).forEach((form) => {
  form.addEventListener("input", (e) => {
    const input = e.target;
    if (input.hasAttribute("aria-invalid") && validators[input.id]) setFieldError(input, validators[input.id]());
    // the confirm field depends on the password field
    for (const [pw, confirm] of [["su-password", "su-confirm"], ["np-password", "np-confirm"]]) {
      if (input.id === pw && $(confirm).hasAttribute("aria-invalid")) setFieldError($(confirm), validators[confirm]());
    }
    hideAlert();
  });
  form.addEventListener("focusout", (e) => {
    const input = e.target;
    if (!["identifier", "su-email", "rs-email", "rs-name", "su-confirm", "np-confirm"].includes(input.id) || !input.value.trim()) return;
    const validate = () => setFieldError(input, validators[input.id]());
    // A new error line shifts the layout. If the user is mid-click (e.g. on the Terms checkbox),
    // wait until the pointer is released, otherwise the click lands on the wrong element and is lost.
    if (pointerDown) pendingBlur.push(validate); else validate();
  });
});

/* ---------- Submit handling ---------- */
// Server field names → input ids, per form
const FIELD_IDS = {
  signin: { email: "identifier", password: "password" },
  signup: { name: "su-name", email: "su-email", password: "su-password", confirmPassword: "su-confirm" },
  reset: { email: "rs-email", fullName: "rs-name", name: "rs-name", code: "rs-code" },
  newpass: { password: "np-password", confirmPassword: "np-confirm" },
};

function reportError(err, form, fallbackFocus) {
  const e = err instanceof ApiError ? err : new ApiError("unknown", "Something went wrong. Please try again.");
  const map = FIELD_IDS[form] || {};
  let focused = false;
  for (const [field, message] of Object.entries(e.fields || {})) {
    const id = map[field];
    if (!id) continue;
    setFieldError($(id), message);
    if (!focused) { $(id).focus(); focused = true; }
  }
  showAlert(e.message, "error");
  shake();
  if (!focused && fallbackFocus) fallbackFocus.focus();
}

function handle(key, action) {
  const form = forms[key];
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return; // blocks double submit (click + Enter)
    hideAlert();
    if (!validateForm(form)) { shake(); return; }
    const btn = form.querySelector("[data-submit]");
    setBusy("loading", btn);
    try {
      await action(btn);
    } catch (err) {
      setBusy("idle", btn);
      if (action.onError) action.onError(err);
      else reportError(err, key);
    }
  });
}

handle("signin", Object.assign(async (btn) => {
  const result = await api("/login", {
    method: "POST",
    body: { email: $("identifier").value.trim(), password: $("password").value, remember: $("remember").checked },
  });
  const token = result.accessToken || result.token;
  const user = result.user;
  if (!token || !user?.id || !user?.email) {
    throw new ApiError("invalid_response", "The server returned an invalid sign-in response.");
  }
  setBusy("success", btn);
  window.parent.postMessage({
    type: "edusphere-auth-success",
    session: {
      accessToken: token,
      user: {
        id: String(user.id),
        email: user.email,
        fullName: user.fullName || user.name || user.full_name || user.email.split("@")[0],
        role: user.role || "student",
      },
    },
  }, window.location.origin);
}, { onError(err) { $("password").value = ""; reportError(err, "signin", $("password")); } }));

handle("signup", Object.assign(async (btn) => {
  const result = await api("/register", {
    method: "POST",
    body: {
      name: $("su-name").value.trim(), fullName: $("su-name").value.trim(), email: $("su-email").value.trim(),
      password: $("su-password").value, confirmPassword: $("su-confirm").value,
    },
  });
  setBusy("idle", btn);
  $("identifier").value = $("su-email").value.trim();
  $("su-password").value = "";
  $("su-confirm").value = "";
  setMode("signin", { focus: true });
  showAlert(result.message || "Account created. Sign in to continue.", "info");
}, {}));

handle("reset", async (btn) => {
  const email = $("rs-email").value.trim();
  const fullName = $("rs-name").value.trim();
  if (!resetCodeRequested) {
    const result = await api("/forgot-password", { method: "POST", body: { email, fullName } });
    resetCodeRequested = true;
    $("rs-name").closest(".field").hidden = true;
    $("rs-email").closest(".field").hidden = true;
    $("rs-code-field").hidden = false;
    btn.querySelector(".btn__label").textContent = "Verify code";
    setBusy("idle", btn);
    $("rs-code").focus();
    showAlert(result.message || "If the details match an account, a verification code has been sent.", "info");
    return;
  }
  const result = await api("/verify-password-code", {
    method: "POST",
    body: { email, fullName, code: $("rs-code").value.trim() },
  });
  if (!result.resetToken) throw new ApiError("invalid_response", "The server did not return a password reset token.");
  resetToken = result.resetToken;
  setBusy("idle", btn);
  setMode("newpass", { focus: true });
  showAlert("Code verified. Choose a new password.", "info");
});

handle("newpass", async (btn) => {
  if (!resetToken) throw new ApiError("invalid_token", "This reset link is missing or has expired. Please request a new one.");
  await api("/reset-password", {
    method: "POST",
    body: { token: resetToken, password: $("np-password").value, confirmPassword: $("np-confirm").value },
  });
  resetToken = null;
  setBusy("idle", btn);
  $("np-password").value = ""; $("np-confirm").value = "";
  setMode("signin", { focus: true });
  showAlert("Password updated. Sign in with your new password.", "info");
});

googleBtn.addEventListener("click", () => {
  if (busy) return;
  hideAlert();
  window.top.location.assign("/api/auth/google/start");
});

/* ---------- Arriving from an email link, a failed Google round-trip, or a deep link ---------- */
async function handleEntry() {
  const params = new URLSearchParams(location.search);
  const parentUrl = new URL(window.parent.location.href);
  const authError = params.get("auth_error") || parentUrl.searchParams.get("auth_error");
  const hash = location.hash.slice(1);
  const [hashKey, hashVal] = hash.split(/=(.*)/s);

  // Tokens come in the #fragment so they're never sent to servers or logged; remove them from the address bar at once.
  const clean = () => history.replaceState(null, "", location.pathname);

  if (parentUrl.searchParams.get("google_auth") === "complete") {
    window.parent.history.replaceState(null, "", parentUrl.pathname + parentUrl.hash);
    try {
      const result = await api("/google/complete", { method: "POST" });
      if (!result.accessToken || !result.user?.id || !result.user?.email) {
        throw new ApiError("invalid_response", "The server returned an invalid Google sign-in response.");
      }
      window.parent.postMessage({
        type: "edusphere-auth-success",
        session: {
          accessToken: result.accessToken,
          user: {
            id: String(result.user.id),
            email: result.user.email,
            fullName: result.user.fullName || result.user.name || result.user.email.split("@")[0],
            role: result.user.role || "student",
          },
        },
      }, window.location.origin);
    } catch (err) {
      showAlert(err instanceof Error ? err.message : "Google sign-in could not be completed.", "error");
    }
    return;
  }

  if (hashKey === "new-password" && hashVal) {
    resetToken = hashVal;
    clean();
    setMode("newpass", { focus: true, updateHash: false });
    return;
  }

  setMode(["signup", "reset"].includes(hashKey) ? hashKey : "signin", { updateHash: false });

  if (hashKey === "verify-email" && hashVal) {
    clean();
    try {
      await api("/verify-email", { method: "POST", body: { token: hashVal } });
      showAlert("Email confirmed. Thanks! You can sign in now.", "info");
    } catch (err) {
      showAlert(err.message, "error");
    }
  }

  if (authError) {
    const [kind, message] = AUTH_ERRORS[authError] || ["error", "We couldn't complete that sign-in. Please try again."];
    showAlert(message, kind);
    window.parent.history.replaceState(null, "", parentUrl.pathname + (parentUrl.hash || ""));
  }
}

/* bfcache: returning with the Back button must not leave a spinner stuck on */
window.addEventListener("pageshow", (e) => {
  if (e.persisted) { setBusy("idle"); document.querySelectorAll("[data-state]").forEach((b) => { b.dataset.state = ""; }); }
});

handleEntry();
startTree({ canvas: $("tree-canvas"), reducedMotion });
