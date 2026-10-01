/* EduSphere scroll-driven login
 * Scroll position -> video.currentTime (scrubbed, damped), then the real auth
 * panel is revealed over the video's baked-in card. No autoplay, no controls.
 *
 * API:  EduSphereScrollLogin.init(rootEl?)  -> instance | null
 *       instance.destroy()                  -> removes every listener/observer/rAF
 * Auto-inits on DOMContentLoaded for [data-scroll-login] unless it has data-manual.
 */
(function () {
  'use strict';

  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const interp = (pts, x) => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
      }
    }
    return pts[pts.length - 1][1];
  };

  // Source video is 1280x544. Where its baked-in login card sits (fractions of the frame).
  const VW = 1280, VH = 544;
  const CARD = { x0: 0.341, x1: 0.658, y0: 0.068, y1: 0.914 };

  // scroll progress -> video seconds. Last knot (null) is filled with the clip's end.
  const TIMELINE = [
    [0.0, 0.0],    // logo on dark
    [0.25, 1.05],  // character walking in
    [0.5, 1.45],   // reaches the spot, starts lifting the bag
    [0.7, 2.35],   // bag hits the ground
    [0.8, 2.85],   // login starts to materialise (the clip's own hologram rises out of the bag)
    [0.88, 3.33],  // hologram is big enough for the real panel to take over
    [1.0, null],   // full sign-in screen
  ];
  // Portrait screens stop at the bag impact (the clip's own baked-in card appears just after 2.8s,
  // and the real sheet rises from that moment instead).
  const TIMELINE_SHEET = [[0, 0], [0.25, 1.05], [0.5, 1.45], [0.7, 2.2], [0.8, 2.45], [1.0, 2.7]];
  // Where a narrow (portrait) crop should look, by video second: centre of view as a fraction of frame width.
  const FOCUS = [[0, 0.5], [0.7, 0.45], [1.2, 0.3], [2.0, 0.36], [2.8, 0.32], [5.2, 0.3]];

  const REVEAL_FROM = 0.8, REVEAL_TO = 0.94, LIVE_AT = 0.9;   // portrait bottom-sheet only

  // Wide screens: the real panel follows the clip's own hologram, frame by frame, so it grows out of it
  // instead of popping in. Measured on the clip: hologram width (fraction of frame width) and how far
  // its centre sits below its final position (fraction of frame height) at each frame.
  const FPS = 30;
  const PANEL_W = [[84, 0.06], [86, 0.095], [88, 0.132], [90, 0.171], [92, 0.19], [94, 0.213], [95, 0.225], [100, 0.247],
  [110, 0.262], [120, 0.277], [130, 0.289], [140, 0.301], [154, 0.317]];
  const PANEL_W_END = 0.317;
  const PANEL_DY = [[86, 0.1], [88, 0.07], [91, 0.03], [95, 0]];
  const HANDOVER = [91, 96.5];   // real panel fades in over the hologram (frames)
  const CONTENT = [98, 112];    // its contents fade in with the scroll (frames)
  const LIVE_FRAME = 112;       // interactive from here

  function init(root) {
    root = root || document.querySelector('[data-scroll-login]');
    if (!root || root.__esl) return root && root.__esl || null;

    const $ = (s) => root.querySelector(s);
    const track = $('.esl-track'), stage = $('.esl-stage'), media = $('.esl-media'),
      video = $('.esl-video'), fallback = $('.esl-fallback'), panel = $('.esl-panel'),
      hint = $('.esl-hint'), skip = $('.esl-skip'), inner = $('.esl-inner');

    const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
    const cleanups = [];
    const on = (t, e, f, o) => { t.addEventListener(e, f, o); cleanups.push(() => t.removeEventListener(e, f, o)); };

    let W = 0, H = 0, dw = 0, dh = 0, sheet = false, scrollable = 1;
    let cur = 0, target = 0, raf = 0, last = 0;
    let duration = 0, endT = 5.11, ready = false, failed = false;   // endT: sane default so the panel is reachable even if the clip never loads
    let lastSeek = -1, pendingSeek = null, unlocking = false;
    let isLive = false, lastPos = '', currentSrc = '';
    let lockY = 0, unlocked = false;   // pins the panel open while typing, until the user scrolls away on purpose
    let staticMode = reduceMQ.matches;

    // ---------------------------------------------------------- video source
    function pickSource() {
      const mobile = W <= 760 || sheet;
      // H.264 MP4 everywhere it's supported; WebM (VP9) for browsers built without H.264.
      const mp4 = !!video.canPlayType('video/mp4; codecs="avc1.42E01E"');
      const d = root.dataset;
      // Big screens get the full-resolution clip (optional attribute); everything else the lighter one.
      const hd = mp4 && !mobile && W >= 1500 && d.videoHd;
      const src = hd ? d.videoHd
        : mp4 || !(mobile ? d.videoMobileWebm : d.videoWebm)
          ? (mobile ? d.videoMobile : d.video)
          : (mobile ? d.videoMobileWebm : d.videoWebm);
      if (!src || src === currentSrc) return;
      currentSrc = src;
      ready = false;
      loadSource(src);
    }

    // Let the browser stream the clip and issue byte-range requests. This shows the poster
    // immediately and avoids waiting for the entire video before the first frame can render.
    function loadSource(src) {
      video.src = src;
      video.load();
    }

    on(video, 'loadedmetadata', () => {
      duration = video.duration || 5.1;
      endT = Math.max(0, duration - 0.05);
    });
    on(video, 'loadeddata', () => {
      ready = true;
      lastSeek = -1;
      // iOS/Safari only paint seeked frames once playback has been "unlocked" — do it silently, muted.
      unlocking = true;
      const p = video.play();
      const done = () => { video.pause(); unlocking = false; lastSeek = -1; schedule(); };
      if (p && p.then) p.then(done, () => { unlocking = false; schedule(); }); else done();
    });
    on(video, 'seeked', () => {
      if (pendingSeek !== null) { const t = pendingSeek; pendingSeek = null; video.currentTime = t; }
    });
    on(video, 'play', () => { if (!unlocking) video.pause(); });      // cannot be played like a normal video
    on(video, 'error', () => {
      failed = true;                                                  // degrade to a poster cross-fade
      fallback.hidden = false;
      fallback.src = root.dataset.posterEnd || '';
      schedule();
    });

    // ------------------------------------------------------------- measuring
    function measure() {
      W = stage.clientWidth; H = stage.clientHeight;
      sheet = W < 640 || W < H;
      root.dataset.layout = sheet ? 'sheet' : 'panel';
      if (sheet) {
        // Fit ~44% of the scene's width on screen (logo, walker and bag all readable),
        // in a band at the top; the sheet rises over the rest.
        dw = W * 2.28; dh = dw * VH / VW;
        if (dh > H * 0.72) { dh = H * 0.72; dw = dh * VW / VH; }
        media.style.top = Math.round((H - dh) / 2) + 'px';
        media.style.bottom = 'auto';
        media.style.height = Math.round(dh) + 'px';
      } else {
        const s = Math.max(W / VW, H / VH);
        dw = VW * s; dh = VH * s;
        media.style.top = media.style.bottom = media.style.height = '';
      }
      if (!sheet) {
        // Size the real panel so it fully covers the video's baked-in card at the final frame.
        panel.style.setProperty('--esl-w', Math.round((CARD.x1 - CARD.x0) * dw * 1.05) + 'px');
        panel.style.setProperty('--esl-h', Math.round((CARD.y1 - CARD.y0) * dh * 1.05) + 'px');
        panel.style.setProperty('--esl-dy', Math.round(((CARD.y0 + CARD.y1) / 2 - 0.5) * dh) + 'px');
      }
      scrollable = Math.max(1, track.offsetHeight - H);
      pickSource();
    }

    // -------------------------------------------------------------- rendering
    function timeAt(p) {
      const pts = (sheet ? TIMELINE_SHEET : TIMELINE).map(([a, b]) => [a, b === null ? endT : b]);
      return interp(pts, p);
    }

    function seek(t) {
      if (!ready || failed) return;
      if (Math.abs(t - lastSeek) < 0.004) return;
      lastSeek = t;
      if (video.seeking) pendingSeek = t; else video.currentTime = t;
    }

    function render(p) {
      const t = timeAt(p);
      seek(t);

      // Narrow screens: pan the crop to follow the character, then lift the scene above the sheet.
      let pos = 50;
      if (sheet && W < dw) {
        const f = W / dw;
        pos = clamp((interp(FOCUS, t) - f / 2) / (1 - f), 0, 1) * 100;
      }
      const posStr = pos.toFixed(2) + '% 50%';
      if (posStr !== lastPos) { video.style.objectPosition = posStr; fallback.style.objectPosition = posStr; lastPos = posStr; }

      const r = smooth((p - REVEAL_FROM) / (REVEAL_TO - REVEAL_FROM));    // portrait sheet
      const f = t * FPS;                                                  // wide screens: video frame

      if (failed) fallback.style.opacity = smooth((p - 0.55) / 0.3);

      // Portrait: raise the scene to the top so the walker stays above the rising sheet.
      media.style.transform = sheet ? 'translate3d(0,' + (-r * Math.max(0, (H - dh) / 2 - 26)).toFixed(1) + 'px,0)' : '';

      let shown;
      if (sheet) {
        panel.style.opacity = shown = r;
        inner.style.opacity = 1;
        panel.style.transform = 'translate3d(0,' + ((1 - r) * 100).toFixed(2) + '%,0)';
      } else {
        // The panel takes over from the clip's hologram: same size and position at every frame, a matching
        // glowing rim that calms down as it settles, and contents that fade in as you scroll.
        const k = interp(PANEL_W, f) / PANEL_W_END;
        const rise = interp(PANEL_DY, f) * dh;
        const rim = 1 - 0.75 * smooth((f - 100) / 40);
        panel.style.opacity = shown = smooth((f - HANDOVER[0]) / (HANDOVER[1] - HANDOVER[0]));
        inner.style.opacity = smooth((f - CONTENT[0]) / (CONTENT[1] - CONTENT[0]));
        panel.style.setProperty('--esl-rim', rim.toFixed(3));
        panel.style.transform = 'translate3d(-50%, calc(-50% + var(--esl-dy, 0px) + ' + rise.toFixed(1) + 'px), 0) scale(' + k.toFixed(4) + ')';
      }
      panel.style.visibility = shown > 0.001 ? 'visible' : 'hidden';

      const live = staticMode || (sheet ? r >= LIVE_AT : f >= LIVE_FRAME);
      if (live !== isLive) {
        isLive = live;
        panel.inert = !live;
        panel.setAttribute('aria-hidden', live ? 'false' : 'true');
        panel.classList.toggle('is-live', live);
      }

      const hintOp = 1 - smooth(p / 0.06);
      hint.style.opacity = hintOp;
      const skipOn = p < 0.85 && !staticMode;
      skip.style.opacity = skipOn ? 1 : 0;
      skip.style.visibility = skipOn ? 'visible' : 'hidden';
    }

    function readTarget() {
      if (staticMode) return 1;
      // Keep the panel fully open while someone is typing (mobile keyboards can nudge the scroll position),
      // but once they scroll away on purpose (> 80px) let the story rewind as normal.
      if (isLive && !unlocked && panel.contains(document.activeElement)) {
        if (Math.abs(window.scrollY - lockY) < 80) return 1;
        unlocked = true;
      }
      return clamp(-track.getBoundingClientRect().top / scrollable, 0, 1);
    }

    function frame(now) {
      raf = 0;
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      target = readTarget();
      // Frame-rate independent damping: gives the cinematic ease without lagging behind the scroll.
      cur += (target - cur) * (1 - Math.exp(-dt * 9));
      if (Math.abs(target - cur) < 0.0004) cur = target;
      render(cur);
      if (cur !== target) schedule();
    }
    function schedule() { if (!raf) raf = requestAnimationFrame(frame); }

    // ----------------------------------------------------------- page events
    on(window, 'scroll', schedule, { passive: true });
    let lastW = 0, lastH = 0;
    const onResize = () => {
      // Ignore tiny height-only changes (mobile URL bar) to avoid re-measuring mid-scroll.
      const w = stage.clientWidth, h = stage.clientHeight;
      if (w === lastW && Math.abs(h - lastH) < 80 && lastW) { schedule(); return; }
      lastW = w; lastH = h;
      measure(); lastSeek = -1; schedule();
    };
    on(window, 'resize', onResize);
    on(window, 'orientationchange', onResize);
    on(panel, 'focusin', () => { lockY = window.scrollY; unlocked = false; schedule(); });
    on(panel, 'focusout', schedule);
    on(reduceMQ, 'change', () => {
      staticMode = reduceMQ.matches;
      root.classList.toggle('is-static', staticMode);
      measure(); lastSeek = -1; schedule();
    });
    on(document, 'visibilitychange', () => { if (!document.hidden) { lastSeek = -1; schedule(); } });

    on(skip, 'click', () => {
      const top = track.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: top + scrollable, behavior: reduceMQ.matches ? 'auto' : 'smooth' });
    });

    // ------------------------------------------------------------ auth panel
    const authCleanup = initAuth(panel);
    cleanups.push(authCleanup);

    // ----------------------------------------------------------------- boot
    root.classList.toggle('is-static', staticMode);
    if (root.dataset.poster) video.poster = root.dataset.poster;
    measure();
    lastW = stage.clientWidth; lastH = stage.clientHeight;
    if (staticMode) cur = target = 1;
    render(cur);
    schedule();

    const api = {
      destroy() {
        cancelAnimationFrame(raf);
        cleanups.forEach((f) => f());
        video.removeAttribute('src'); video.load();
        delete root.__esl;
      },
    };
    root.__esl = api;
    return api;
  }

  // ======================================================== auth panel logic
  function initAuth(panel) {
    const q = (s) => panel.querySelector(s);
    const qa = (s) => Array.from(panel.querySelectorAll(s));
    const cleanups = [];
    const on = (t, e, f, o) => { t.addEventListener(e, f, o); cleanups.push(() => t.removeEventListener(e, f, o)); };

    const tabs = q('.esl-tabs'), views = q('.esl-views'), title = q('.esl-title'), sub = q('.esl-sub');
    const forms = { signin: q('#esl-signin'), signup: q('#esl-signup'), forgot: q('#esl-forgot') };
    const COPY = {
      signin: ['Sign in to your account', 'Continue your learning journey right where you left off.'],
      signup: ['Create your account', 'Join EduSphere and start learning today.'],
      forgot: ['Reset your password', 'Enter your email and we\u2019ll send you a link to choose a new one.'],
    };
    let view = 'signin';

    function setHeight() {
      views.style.height = forms[view].offsetHeight + 'px';
    }

    function setView(next, focus) {
      if (next === view) return;
      const order = ['signin', 'signup', 'forgot'];
      Object.keys(forms).forEach((k) => {
        const f = forms[k];
        f.classList.toggle('is-active', k === next);
        f.dataset.side = k === next ? '' : (order.indexOf(k) < order.indexOf(next) ? 'left' : 'right');
        f.inert = k !== next;
        f.setAttribute('aria-hidden', k === next ? 'false' : 'true');
      });
      view = next;
      title.textContent = COPY[next][0];
      sub.textContent = COPY[next][1];
      tabs.hidden = next === 'forgot';
      tabs.dataset.active = next === 'signup' ? 'signup' : 'signin';
      qa('.esl-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === next)));
      clearAlerts();
      setHeight();
      if (focus) { const first = forms[next].querySelector('input'); if (first) first.focus({ preventScroll: true }); }
    }

    qa('.esl-tab').forEach((t) => on(t, 'click', () => setView(t.dataset.view, true)));
    qa('[data-goto]').forEach((b) => on(b, 'click', () => setView(b.dataset.goto, true)));

    // Keyboard: arrow keys move between the two tabs
    on(tabs, 'keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      setView(view === 'signin' ? 'signup' : 'signin', false);
      const active = tabs.querySelector('[aria-selected="true"]'); if (active) active.focus();
    });

    // "Forgot password?" — go to the app's existing page if it has one, otherwise use the in-panel form
    on(q('#esl-forgot-link'), 'click', () => {
      const A = window.EduSphereAuth;
      if (A && A.forgotPasswordUrl) { window.location.assign(A.forgotPasswordUrl); return; }
      const em = forms.signin.elements.email.value;
      setView('forgot', true);
      if (em) forms.forgot.elements.email.value = em;
    });

    // Show / hide password
    qa('.esl-eye').forEach((btn) =>
      on(btn, 'click', () => {
        const input = panel.querySelector('#' + btn.dataset.for);
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.setAttribute('aria-pressed', String(show));
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      })
    );

    // Alerts + field errors
    function alertFor(form) { return form.querySelector('.esl-alert'); }
    function showAlert(form, kind, msg) {
      const a = alertFor(form); a.dataset.kind = kind; a.textContent = msg; a.hidden = false; setHeight();
    }
    function clearAlerts() {
      Object.values(forms).forEach((f) => { const a = alertFor(f); a.hidden = true; a.textContent = ''; });
      qa('.esl-err').forEach((e) => (e.textContent = ''));
      qa('.esl-input').forEach((i) => i.removeAttribute('aria-invalid'));
    }
    function fieldError(input, msg) {
      input.setAttribute('aria-invalid', 'true');
      const e = panel.querySelector('#' + input.id + '-err'); if (e) e.textContent = msg;
    }
    qa('.esl-input').forEach((i) =>
      on(i, 'input', () => {
        if (i.getAttribute('aria-invalid')) {
          i.removeAttribute('aria-invalid');
          const e = panel.querySelector('#' + i.id + '-err'); if (e) e.textContent = '';
          setHeight();
        }
      })
    );

    const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    function validate(kind, f) {
      const el = f.elements; const bad = [];
      const need = (input, cond, msg) => { if (!cond) { fieldError(input, msg); bad.push(input); } };
      if (kind === 'signup') need(el.name, el.name.value.trim().length > 0, 'Enter your name.');
      need(el.email, EMAIL.test(el.email.value.trim()), 'Enter a valid email address.');
      if (kind === 'signin') need(el.password, el.password.value.length > 0, 'Enter your password.');
      if (kind === 'signup') {
        need(el.password, el.password.value.length >= 12, 'Use at least 12 characters.');
        need(el.confirm, el.confirm.value === el.password.value, 'Passwords don\u2019t match.');
      }
      if (bad.length) { setHeight(); bad[0].focus({ preventScroll: true }); }
      return bad.length === 0;
    }

    function values(f) {
      const o = {};
      Array.from(f.elements).forEach((e) => { if (e.name) o[e.name] = e.type === 'email' || e.name === 'name' ? e.value.trim() : e.value; });
      return o;
    }

    async function submit(kind, f) {
      clearAlerts();
      if (!validate(kind, f)) return;
      const btn = f.querySelector('.esl-btn');
      btn.disabled = true; btn.setAttribute('aria-busy', 'true');
      try {
        const A = window.EduSphereAuth;
        const fn = A && (kind === 'signin' ? A.signIn : kind === 'signup' ? A.signUp : A.requestPasswordReset);
        if (typeof fn !== 'function') throw new Error('Authentication isn\u2019t available on this page.');
        const res = (await fn.call(A, values(f))) || {};
        showAlert(f, 'ok', res.message || 'Done.');
        panel.dispatchEvent(new CustomEvent('edusphere:auth', { bubbles: true, detail: { kind, result: res } }));
        if (res.redirectTo) {
          btn.setAttribute('aria-busy', 'true');
          window.location.assign(res.redirectTo);
          return; // leave the button busy while the browser navigates
        }
      } catch (err) {
        showAlert(f, 'error', (err && err.message) || 'Something went wrong. Try again.');
      }
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }

    on(forms.signin, 'submit', (e) => { e.preventDefault(); submit('signin', forms.signin); });
    on(forms.signup, 'submit', (e) => { e.preventDefault(); submit('signup', forms.signup); });
    on(forms.forgot, 'submit', (e) => { e.preventDefault(); submit('forgot', forms.forgot); });

    // Keep the animated height right when content changes size
    const ro = 'ResizeObserver' in window ? new ResizeObserver(setHeight) : null;
    if (ro) Object.values(forms).forEach((f) => ro.observe(f));
    cleanups.push(() => ro && ro.disconnect());

    // Initial state
    Object.keys(forms).forEach((k) => { forms[k].inert = k !== 'signin'; forms[k].setAttribute('aria-hidden', k === 'signin' ? 'false' : 'true'); });
    forms.signin.classList.add('is-active');
    requestAnimationFrame(setHeight);
    if (/[?&]mode=signup\b/.test(location.search)) { view = 'signin'; setView('signup', false); }

    return () => cleanups.forEach((f) => f());
  }

  window.EduSphereScrollLogin = { init };
  const boot = () => { const r = document.querySelector('[data-scroll-login]'); if (r && !r.hasAttribute('data-manual')) init(r); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
