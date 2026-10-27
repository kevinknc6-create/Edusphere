/** Tiny cookie parser (avoids another dependency). Only the CSRF cookie is read through it. */
export function cookieParser(req, _res, next) {
  const out = {};
  const header = req.headers.cookie;
  if (header) {
    for (const part of header.split(";")) {
      const i = part.indexOf("=");
      if (i < 0) continue;
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      if (!(k in out)) {
        try { out[k] = decodeURIComponent(v); } catch { /* ignore malformed */ }
      }
    }
  }
  req.cookies = out;
  next();
}
