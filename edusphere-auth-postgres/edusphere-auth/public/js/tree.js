/**
 * Wind-blown tree + rippling water, drawn with one small WebGL shader.
 *
 * The supplied picture is a single flat image, so individual branches can't be animated as
 * separate objects. Instead we warp the picture: a mask (built once, in the browser, from the
 * leaf colours of the photo) says "this pixel is foliage", and the shader
 *   - bends the crown around the trunk top: pixels further from the pivot move more, with a phase
 *     delay across the canopy so different parts of the crown sway slightly out of step,
 *   - adds a faster branch wobble and a tiny per-leaf flutter,
 *   - keeps the trunk, roots and the whole horizon band still (mask = 0 there, plus a trunk lock),
 *   - bends the *reflection* with the same wind (mirrored) and adds travelling ripples,
 *   - pulses a faint turquoise glow along the horizon.
 * The whole image is never rotated or scaled. If WebGL is unavailable, or the visitor prefers
 * reduced motion, nothing here runs and the CSS version of the photo stays in place.
 */

const IMG_DESKTOP = "assets/tree-water-bg.jpg";
const IMG_MOBILE = "assets/tree-water-bg-mobile.jpg";

// Landmarks of the supplied photo, in 0..1 image coordinates.
const FOCUS = [0.52, 0.45];   // point of the image that gets placed at the viewport anchor
const HORIZON = 0.553;        // y of the turquoise horizon line

const VERT = `
attribute vec2 a_pos;
varying vec2 v_pos;
void main() { v_pos = a_pos * 0.5 + 0.5; v_pos.y = 1.0 - v_pos.y; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_pos;
uniform sampler2D u_img;
uniform sampler2D u_mask;
uniform float u_time;
uniform vec2 u_res;      // canvas size in device px
uniform vec2 u_anchor;   // where FOCUS lands in the viewport (0..1)
uniform vec2 u_imgPx;    // image size in device px after cover-scaling
uniform float u_amp;     // overall wind strength (smaller on phones)

const vec2 FOCUS_ = vec2(${FOCUS[0]}, ${FOCUS[1]});
const float HORIZON_ = ${HORIZON};
const vec2 PIVOT = vec2(0.52, 0.49);  // top of the trunk, where the crown "hinges"

void main() {
  vec2 uv = (v_pos * u_res - u_anchor * u_res) / u_imgPx + FOCUS_;
  float t = u_time;

  float foliage = texture2D(u_mask, uv).r;

  // Water below the horizon mirrors the crown: evaluate the wind at the mirrored height.
  float inWater = step(HORIZON_ + 0.012, uv.y);
  float yEff = mix(uv.y, HORIZON_ - (uv.y - HORIZON_) / 1.2, inWater);
  vec2 p = vec2(uv.x - PIVOT.x, yEff - PIVOT.y);

  // Tips of the crown move most; the hinge barely at all.
  float bend = pow(clamp(length(p) / 0.2, 0.0, 1.0), 1.35);
  // Trunk and roots stay put: lock everything close to the trunk axis in the lower part of the tree.
  float lock = mix(smoothstep(0.035, 0.13, abs(p.x)), 1.0, 1.0 - smoothstep(0.36, 0.44, yEff));
  float w = foliage * bend * lock * u_amp;

  // Gusty base wind, travelling left→right across the crown.
  float gust = 0.65 + 0.35 * sin(t * 0.17 + 0.8);
  float phase = -p.x * 3.2 + p.y * 2.0;
  float wind = 0.55 * sin(t * 0.62 + phase)
             + 0.30 * sin(t * 1.10 + 1.7 + phase * 1.6)
             + 0.15 * sin(t * 2.30 + 0.4 + phase * 2.5);
  float branch = sin(t * 1.7 - p.x * 9.0 + p.y * 7.0) * 0.0016
               + sin(t * 2.4 + p.x * 15.0 - p.y * 11.0) * 0.0008;

  // Leaf flutter: fast, tiny, different for every spot.
  float fl = 0.5 + 0.5 * sin(t * 0.9 + uv.x * 31.0 + uv.y * 17.0);
  vec2 flutter = vec2(sin(t * 3.3 + uv.x * 150.0 + uv.y * 93.0),
                      cos(t * 2.9 + uv.x * 117.0 - uv.y * 141.0)) * 0.0011 * fl;

  vec2 d = vec2(wind * gust * 0.0065 + branch, sin(t * 1.3 + p.x * 8.0) * 0.0012 - abs(wind) * 0.0010) * w
         + flutter * w;
  d.y *= 1.0 - 2.0 * inWater; // reflection moves vertically the opposite way

  // Water ripples: bands that drift sideways, stronger further from the horizon.
  float depth = smoothstep(HORIZON_, HORIZON_ + 0.07, uv.y) * inWater;
  float ripple = sin(uv.y * 240.0 + t * 1.4 + sin(uv.x * 17.0 + t * 0.5) * 2.0) * 0.0022
               + sin(uv.y * 95.0 - t * 0.8 + uv.x * 9.0) * 0.0018
               + sin(uv.y * 520.0 + t * 2.1 + uv.x * 40.0) * 0.0006;
  d.x += ripple * depth;

  vec3 col = texture2D(u_img, clamp(uv - d, 0.0, 1.0)).rgb;

  // Water glints, only where the reflection is already lit.
  float lit = smoothstep(0.08, 0.45, col.g);
  col += vec3(0.02, 0.07, 0.04) * (0.5 + 0.5 * sin(uv.y * 300.0 - t * 1.8 + uv.x * 30.0)) * lit * depth;

  // Slow turquoise pulse along the horizon.
  float band = exp(-pow((uv.y - HORIZON_) / 0.011, 2.0));
  col += vec3(0.05, 0.40, 0.36) * band * (0.10 + 0.07 * sin(t * 0.8 + uv.x * 6.0));

  gl_FragColor = vec4(col, 1.0);
}`;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Foliage mask from the photo itself: green, leafy pixels of the canopy and of its reflection. */
function buildMask(img) {
  const w = 388;
  const h = Math.round((w * img.naturalHeight) / img.naturalWidth);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;

  let m = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    const y = j / h;
    const zone = y < HORIZON - 0.008 || y > HORIZON + 0.015; // skip the horizon glow band itself
    if (!zone) continue;
    for (let i = 0; i < w; i++) {
      const x = i / w;
      if (x < 0.27 || x > 0.73) continue; // the tree and its reflection live in this column
      const k = (j * w + i) * 4;
      const r = px[k] / 255, g = px[k + 1] / 255, b = px[k + 2] / 255;
      if (g > 0.16 && g > b * 1.15 && g > r * 0.95) m[j * w + i] = 255;
    }
  }

  // Dilate a little (so leaves can swing past their original outline), then soften the edge.
  const filter = (src, radius, reduce) => {
    const out = new Uint8Array(src.length);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        let acc = 0, mx = 0, n = 0;
        for (let dj = -radius; dj <= radius; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= h) continue;
          for (let di = -radius; di <= radius; di++) {
            const ii = i + di;
            if (ii < 0 || ii >= w) continue;
            const v = src[jj * w + ii];
            acc += v; n++;
            if (v > mx) mx = v;
          }
        }
        out[j * w + i] = reduce === "max" ? mx : acc / n;
      }
    }
    return out;
  };
  m = filter(m, 2, "max");   // dilate
  m = filter(m, 3, "mean");  // soften
  return { data: m, w, h };
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader compile failed");
  return s;
}

function texture(gl, unit) {
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/**
 * Starts the animation. Returns a `stop()` function. Safe to call when WebGL is unsupported
 * (it simply leaves the CSS background in place).
 */
export function startTree({ canvas, reducedMotion }) {
  const root = canvas.closest(".bg");
  let stopCurrent = null;
  let starting = false;

  async function run() {
    if (starting || stopCurrent) return;
    starting = true;
    try {
      const gl = canvas.getContext("webgl", { alpha: false, antialias: false, powerPreference: "low-power", preserveDrawingBuffer: false });
      if (!gl) return;

      const small = window.matchMedia("(max-width: 45em)").matches;
      const img = await loadImage(small ? IMG_MOBILE : IMG_DESKTOP);
      const mask = buildMask(img);

      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "a_pos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      texture(gl, 0); // unit 0: the photo
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      texture(gl, 1); // unit 1: the foliage mask
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, mask.w, mask.h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, mask.data);

      const U = (n) => gl.getUniformLocation(prog, n);
      const u = { time: U("u_time"), res: U("u_res"), anchor: U("u_anchor"), imgPx: U("u_imgPx"), amp: U("u_amp") };
      gl.uniform1i(U("u_img"), 0);
      gl.uniform1i(U("u_mask"), 1);

      let w = 0, h = 0, raf = 0, stopped = false, shown = false;
      const t0 = performance.now();

      function layout() {
        // Fewer pixels on phones: the effect is soft anyway and it saves battery.
        const dpr = Math.min(window.devicePixelRatio || 1, small ? 1 : 1.5);
        const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
        const ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (cw !== w || ch !== h) { w = cw; h = ch; canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }

        // "cover" fit, with a little extra zoom so the edges never show.
        const s = Math.max(w / img.naturalWidth, h / img.naturalHeight) * 1.04;
        const wide = window.matchMedia("(min-width: 62em) and (min-height: 600px)").matches;
        const portrait = h > w;
        const anchor = wide ? [0.42, 0.5] : portrait ? [0.5, 0.36] : [0.5, 0.5];
        gl.uniform2f(u.res, w, h);
        gl.uniform2f(u.anchor, anchor[0], anchor[1]);
        gl.uniform2f(u.imgPx, img.naturalWidth * s, img.naturalHeight * s);
        gl.uniform1f(u.amp, small ? 0.8 : 1.0);
      }

      function frame(now) {
        if (stopped) return;
        gl.uniform1f(u.time, (now - t0) / 1000);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (!shown) { shown = true; root.classList.add("bg--gl"); }
        raf = requestAnimationFrame(frame);
      }

      const ro = new ResizeObserver(layout);
      ro.observe(canvas);
      layout();
      raf = requestAnimationFrame(frame);

      const onLost = (e) => { e.preventDefault(); stop(); };
      canvas.addEventListener("webglcontextlost", onLost);

      function stop() {
        stopped = true;
        cancelAnimationFrame(raf);
        ro.disconnect();
        canvas.removeEventListener("webglcontextlost", onLost);
        root.classList.remove("bg--gl");
        stopCurrent = null;
      }
      stopCurrent = stop;
    } catch (err) {
      console.warn("[tree] animation disabled:", err.message);
      root.classList.remove("bg--gl");
    } finally {
      starting = false;
    }
  }

  const sync = () => {
    if (reducedMotion.matches) { stopCurrent?.(); } else { run(); }
  };
  reducedMotion.addEventListener("change", sync);
  sync();
  return () => stopCurrent?.();
}
