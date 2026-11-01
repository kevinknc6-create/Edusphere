# EduSphere scroll-driven login — integration guide

Scroll position drives the video (`currentTime`), then the real sign-in / sign-up panel
rises out of the bag impact. No autoplay, no controls, no fake auth.

## What's in the folder

| File | Purpose |
|---|---|
| `index.html` | Working demo page. The block between the `EduSphere scroll-driven login` comments is what you move into your login page. |
| `css/scroll-login.css` | All styles, scoped under `.esl`. |
| `js/scroll-login.js` | Scroll → video engine + form behaviour. Exposes `EduSphereScrollLogin.init()` / `.destroy()`. |
| `js/auth-adapter.js` | **The only file that talks to your backend.** |
| `assets/scrub.mp4`, `scrub-mobile.mp4` | All-keyframe H.264 (2.1 MB / 1.2 MB) so scrubbing is instant. |
| `assets/scrub-hd.mp4` | Optional. Native 1698×720 all-keyframe clip (4.3 MB), loaded only on screens ≥ 1500px wide. Remove the `data-video-hd` attribute to skip it. |
| `assets/scrub.webm`, `scrub-mobile.webm` | Fallback for browsers built without H.264. Delete if you don't want them. |
| `assets/poster*.jpg` | First / last frame (poster and error fallback). |

## 1. Mount it in your existing login page

1. Copy `css/`, `js/`, `assets/` next to (or into) your static/public folder.
2. Paste the `<main class="esl" …>` block from `index.html` into your login route/template. Keep the `data-*` paths correct for where you put `assets/`.
3. Add `<link rel="stylesheet" href="…/scroll-login.css">`, then `auth-adapter.js`, then `scroll-login.js` (`defer`).
4. Keep your route (e.g. `/login`). Nothing here changes routing, cookies, env vars or the database.

**React / Vue / Next / Svelte:** render the same markup, put `assets/` in `public/`, add
`data-manual` to the `<main>`, and call `const inst = EduSphereScrollLogin.init(rootEl)` after mount and
`inst.destroy()` on unmount. `destroy()` removes every listener, observer, rAF and blob URL.
Import the two scripts once (they attach to `window`).

## 2. Connect authentication (required)

Until you do, submitting shows *"The form isn't connected to EduSphere yet"* — deliberately.

Open `js/auth-adapter.js` and pick one:

**A. REST/JSON endpoints** — set `signIn.url`, `signUp.url` (and optionally `forgot.url`), map the
field names in each `body: (v) => ({...})`, set `redirectTo`. Session cookies are sent
(`credentials: 'include'`). Bearer tokens: store them in `onSuccess`. CSRF: set `csrf`.

**B. An SDK you already use** — replace the adapter before `scroll-login.js` loads, e.g.:

```js
// Supabase
window.EduSphereAuth = {
  async signIn({ email, password }) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return { redirectTo: '/dashboard' };
  },
  async signUp({ name, email, password }) {
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { name } } });
    if (error) throw new Error(error.message);
    return { redirectTo: '/dashboard' };
  },
  async requestPasswordReset({ email }) {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw new Error(error.message);
    return { message: 'If that email has an account, a reset link is on its way.' };
  },
};
```
(Firebase: `signInWithEmailAndPassword`, `createUserWithEmailAndPassword`, `sendPasswordResetEmail` — same shape.)

**C. Server-rendered forms** (Laravel / Django / Rails / PHP) — set `format: 'form'`, point `url` at the route
your current form posts to, and set `csrf`.

Contract: resolve `{ redirectTo?, message? }` on success; **throw `Error("readable message")`** on failure.
If your app already has a reset-password page, set `forgot.pageUrl` and the link just goes there.
The panel also emits a bubbling `edusphere:auth` event on success.

If your registration needs more fields (role, school, terms checkbox), add inputs to `#esl-signup`
with a `name` and read them in the adapter's `body`.

## 3. Things to check on your side

- **CSP:** if you send a Content-Security-Policy you need `media-src blob:` and `connect-src 'self'`
  (the clip is fetched into a blob so it seeks reliably on any server).
- **Fonts:** uses the system font stack (nothing extra to load). Set `--esl-font` on `.esl` to use your brand font.
- **Cache headers:** serve `assets/` with long-lived caching.
- **Deep link to sign-up:** `/login?mode=signup` opens the Create account tab.

## Behaviour notes

- Scroll map (approx.): 0% logo · 25% walking · 50% reaches spot, lifts bag · 70% bag hits ground ·
  80% panel starts appearing · ~94% fully open and interactive · 100% final. Edit `TIMELINE` at the top of `scroll-login.js`.
- Scrolling back up reverses everything; the panel becomes inert (not tabbable) when it's hidden.
- Phones / portrait: the scene is framed in a band at the top and the sign-in rises as a bottom sheet.
  The clip's own AI-generated login card (its text is garbled) is never shown on portrait, and on wider screens it is fully covered by the real panel.
- `prefers-reduced-motion`: skips the scroll story and shows the sign-in directly. "Skip intro" is available otherwise.
- Without JavaScript the panel is shown statically.

## Revision notes (what was tested and changed)

Tested in real Chrome 141 (Playwright) at 1920×1080, 1366×768, 820×1180, 390×844 and 844×390: scroll position → video time on every
knot of the scroll map, forward and reverse; no horizontal overflow; panel inert/untabbable until live; sign-in ⇄ create-account
switch; validation; show/hide password; "not connected" message; a stub adapter that signs in and reaches a dashboard route;
`prefers-reduced-motion`; no console errors.

Changes in this revision:
- **Hand-over from the clip's hologram.** On wide screens the real panel now follows the clip's own glowing panel frame by frame
  (same size, position and rim) instead of popping in as a flat box, and its contents fade in with the scroll (`PANEL_W`, `HANDOVER`,
  `CONTENT` at the top of `scroll-login.js`). The clip's own login card has garbled AI text; it is fully covered before it becomes legible.
- **Scrolling up works while typing.** The panel stays pinned open while a field is focused (mobile keyboards nudge the scroll), but a
  deliberate scroll of more than 80px rewinds the story.
- **Login is reachable even if the clip fails to load** (previously the panel could stay hidden on wide screens).
- **HD clip** for large screens (see table above).
- Scroll map: `0.88 → 3.33s` added so the hologram rise gets a little more scroll.

Known limits:
- **H.264 playback could not be run in the test environment** (its browsers only decode WebM). The MP4s were verified as valid
  all-keyframe H.264 and the correct file is requested per screen size, but please check the MP4 path once in Chrome/Safari on your side.
- Phones in landscape (~390px tall) have little room: the panel scrolls internally.
- The clip is 720p, so the background is soft on very large displays.

