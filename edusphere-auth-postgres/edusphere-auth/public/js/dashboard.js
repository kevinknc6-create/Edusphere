import { api, ApiError } from "./api.js";
import { startTree } from "./tree.js";

const $ = (id) => document.getElementById(id);
const alertBox = $("alert");
const show = (msg, kind = "error") => {
  $("alert-text").textContent = msg;
  alertBox.classList.toggle("is-info", kind === "info");
  alertBox.hidden = false;
};
const busy = (btn, on) => { btn.disabled = on; btn.dataset.state = on ? "loading" : ""; };

const LINK_ERRORS = {
  google_in_use: "That Google account is already linked to a different EduSphere account.",
  google_already_linked: "Your account already has a different Google account linked.",
  google_cancelled: "Linking was cancelled.",
  google_failed: "We couldn't verify your Google account. Please try again.",
  google_state: "That linking session expired. Please try again.",
  google_network: "Couldn't reach Google. Check your connection and try again.",
  google_email_unverified: "Google says that email address isn't verified, so it can't be linked.",
};

async function load() {
  let user;
  try {
    ({ user } = await api("/me"));
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) { location.replace("/#signin"); return; }
    show(err.message);
    return;
  }

  $("who").textContent = `Welcome, ${user.name.split(" ")[0]}`;
  $("email").textContent = user.email;
  const badges = $("badges");
  badges.replaceChildren();
  const add = (text, cls) => { const li = document.createElement("li"); li.className = `badge ${cls}`; li.textContent = text; badges.append(li); };
  add(user.emailVerified ? "Email verified" : "Email not verified", user.emailVerified ? "badge--ok" : "badge--warn");
  if (user.hasPassword) add("Password", "");
  if (user.providers.includes("google")) add("Google linked", "badge--ok");

  $("verify-box").hidden = user.emailVerified;
  $("google-box").hidden = user.providers.includes("google");
}

$("logout").addEventListener("click", async (e) => {
  busy(e.currentTarget, true);
  try { await api("/logout", { method: "POST", body: {} }); } catch { /* the session is gone either way */ }
  location.replace("/#signin");
});

$("resend").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  busy(btn, true);
  try { await api("/resend-verification", { method: "POST", body: {} }); show("Confirmation email sent. Check your inbox.", "info"); }
  catch (err) { show(err.message); }
  busy(btn, false);
});

$("link-google").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  busy(btn, true);
  try {
    const { url } = await api("/google/link", { method: "POST", body: {} });
    location.assign(url); // Google's consent screen; the server finishes the link on return
  } catch (err) {
    busy(btn, false);
    show(err.code === "reauth_required" ? `${err.message}` : err.message);
  }
});

const params = new URLSearchParams(location.search);
if (params.get("linked") === "google") show("Google account linked. You can now sign in with Google.", "info");
if (params.get("link_error")) show(LINK_ERRORS[params.get("link_error")] || "We couldn't link your Google account.");
if (params.toString()) history.replaceState(null, "", location.pathname);

load();
startTree({ canvas: $("tree-canvas"), reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)") });
