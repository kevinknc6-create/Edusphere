const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const { OAuth2Client } = require("google-auth-library");
const pool = require("../db");

const router = express.Router();
const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI
  || `${(process.env.CLIENT_ORIGIN || "http://localhost:5173").split(",")[0].trim()}/api/auth/google/callback`;
const googleOAuth = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, googleRedirectUri)
  : null;

function cookieOptions(path, maxAge, sameSite = "lax") {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite,
    path,
    maxAge: maxAge * 1000
  };
}

function redirectGoogleError(res, code) {
  const origin = (process.env.CLIENT_ORIGIN || "http://localhost:5173").split(",")[0].trim();
  res.redirect(303, `${origin}/?auth_error=${encodeURIComponent(code)}#signin`);
}

function sameValue(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createUserToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function requestCookie(req, name) {
  return req.cookies?.[name];
}

const GOOGLE_STATE_COOKIE = "edusphere_google_state";
const GOOGLE_COMPLETION_COOKIE = "edusphere_google_completion";

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    const claims = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    req.auth = { userId: claims.id || claims.sub };
    if (!req.auth.userId) return res.status(401).json({ message: "Invalid session" });
    next();
  } catch {
    res.status(401).json({ message: "Your session has expired" });
  }
}

// REGISTER
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required"
      });
    }

    const existingUser = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Email already exists"
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, role, created_at`,
      [name, email, passwordHash]
    );

    res.status(201).json({
      success: true,
      message: "Account created successfully",
      user: result.rows[0]
    });

  } catch (error) {
    console.error("REGISTER ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

// LOGIN
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const result = await pool.query(
      "SELECT * FROM users WHERE lower(email) = lower($1)",
      [email.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const user = result.rows[0];

    if (user.status && user.status !== "active") {
      return res.status(403).json({ success: false, message: "This account is not active" });
    }

    const passwordMatch = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d"
      }
    );

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    console.error("LOGIN ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, email, role, status FROM users WHERE id = $1",
      [req.auth.userId]
    );
    const user = result.rows[0];
    if (!user || (user.status && user.status !== "active")) {
      return res.status(401).json({ message: "Active session required" });
    }

    res.json({
      data: {
        id: user.id,
        fullName: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error("CURRENT USER ERROR:", error);
    res.status(500).json({ message: "User identity could not be verified" });
  }
});

router.post("/logout", (_req, res) => res.sendStatus(204));

router.get("/google/start", (_req, res) => {
  if (!googleOAuth) return redirectGoogleError(res, "google_not_configured");

  const state = crypto.randomBytes(32).toString("base64url");
  const nonce = crypto.randomBytes(32).toString("base64url");
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const signedState = jwt.sign(
    { state, nonce, codeVerifier, type: "google-oauth-state" },
    process.env.JWT_SECRET,
    { expiresIn: "10m", issuer: "edusphere-google" }
  );
  res.cookie(GOOGLE_STATE_COOKIE, signedState, cookieOptions("/api/auth/google/callback", 600));
  res.setHeader("Cache-Control", "no-store");
  res.redirect(303, googleOAuth.generateAuthUrl({
    scope: ["openid", "email", "profile"],
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account"
  }));
});

router.get("/google/callback", async (req, res) => {
  res.clearCookie(GOOGLE_STATE_COOKIE, cookieOptions("/api/auth/google/callback", 0));
  if (!googleOAuth || !process.env.GOOGLE_CLIENT_ID) return redirectGoogleError(res, "google_not_configured");
  if (req.query.error) return redirectGoogleError(res, req.query.error === "access_denied" ? "google_cancelled" : "google_failed");

  let state;
  try {
    state = jwt.verify(requestCookie(req, GOOGLE_STATE_COOKIE) || "", process.env.JWT_SECRET, { issuer: "edusphere-google" });
    if (state.type !== "google-oauth-state" || !sameValue(req.query.state, state.state)) throw new Error("Invalid OAuth state");
  } catch {
    return redirectGoogleError(res, "google_state");
  }
  if (typeof req.query.code !== "string") return redirectGoogleError(res, "google_failed");

  let profile;
  try {
    const { tokens } = await googleOAuth.getToken({ code: req.query.code, codeVerifier: state.codeVerifier });
    if (!tokens.id_token) throw new Error("Google did not return an ID token");
    const ticket = await googleOAuth.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    profile = ticket.getPayload();
  } catch (error) {
    console.error("[google] OAuth verification failed:", error instanceof Error ? error.message : "unknown error");
    return redirectGoogleError(res, "google_failed");
  }
  if (!profile?.sub || !sameValue(profile.nonce, state.nonce)
    || !["https://accounts.google.com", "accounts.google.com"].includes(profile.iss)) {
    return redirectGoogleError(res, "google_failed");
  }
  if (profile.email_verified !== true || !profile.email) return redirectGoogleError(res, "google_email_unverified");

  const email = profile.email.trim().toLowerCase();
  const name = (profile.name || email.split("@")[0]).replace(/\p{Cc}/gu, "").trim().slice(0, 120) || "EduSphere learner";
  const client = await pool.connect();
  let user;
  try {
    await client.query("BEGIN");
    const known = await client.query(
      `SELECT u.id, u.name, u.email, u.role, u.status
         FROM auth_identities i JOIN users u ON u.id = i.user_id
        WHERE i.provider = 'google' AND i.provider_user_id = $1
        FOR UPDATE OF u`,
      [profile.sub]
    );
    user = known.rows[0];

    if (user) {
      await client.query(
        "UPDATE auth_identities SET email = $1, last_login_at = now() WHERE provider = 'google' AND provider_user_id = $2",
        [email, profile.sub]
      );
    } else {
      const matchingEmail = await client.query(
        "SELECT id, name, email, role, status FROM users WHERE lower(email) = $1 FOR UPDATE",
        [email]
      );
      user = matchingEmail.rows[0];
      if (user) {
        await client.query(
          "INSERT INTO auth_identities (user_id, provider, provider_user_id, email) VALUES ($1, 'google', $2, $3)",
          [user.id, profile.sub, email]
        );
        await client.query(
          "UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1",
          [user.id]
        );
      } else {
        const passwordHash = await bcrypt.hash(crypto.randomBytes(48).toString("base64url"), 12);
        const created = await client.query(
          `INSERT INTO users (name, email, password_hash, role, status, email_verified_at)
           VALUES ($1, $2, $3, 'student', 'active', now())
           RETURNING id, name, email, role, status`,
          [name, email, passwordHash]
        );
        user = created.rows[0];
        await client.query(
          "INSERT INTO auth_identities (user_id, provider, provider_user_id, email) VALUES ($1, 'google', $2, $3)",
          [user.id, profile.sub, email]
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error?.code === "23505") return redirectGoogleError(res, "google_email_exists");
    console.error("GOOGLE SIGN-IN ERROR:", error);
    return redirectGoogleError(res, "google_failed");
  } finally {
    client.release();
  }

  if (!user || (user.status && user.status !== "active")) return redirectGoogleError(res, "google_failed");
  const completion = jwt.sign(
    { id: user.id, type: "google-oauth-completion" },
    process.env.JWT_SECRET,
    { expiresIn: "60s", issuer: "edusphere-google" }
  );
  res.cookie(
    GOOGLE_COMPLETION_COOKIE,
    completion,
    cookieOptions("/api/auth/google/complete", 60, process.env.COOKIE_SAME_SITE || "lax")
  );
  res.redirect(303, `${(process.env.CLIENT_ORIGIN || "http://localhost:5173").split(",")[0].trim()}/?google_auth=complete`);
});

router.post("/google/complete", async (req, res) => {
  const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173").split(",").map((origin) => origin.trim());
  if (req.get("origin") && !allowedOrigins.includes(req.get("origin"))) {
    return res.status(403).json({ message: "Google sign-in completion was requested from an untrusted origin" });
  }

  res.clearCookie(
    GOOGLE_COMPLETION_COOKIE,
    cookieOptions("/api/auth/google/complete", 0, process.env.COOKIE_SAME_SITE || "lax")
  );
  let claims;
  try {
    claims = jwt.verify(requestCookie(req, GOOGLE_COMPLETION_COOKIE) || "", process.env.JWT_SECRET, { issuer: "edusphere-google" });
    if (claims.type !== "google-oauth-completion") throw new Error("Invalid completion token");
  } catch {
    return res.status(401).json({ message: "Google sign-in could not be completed. Please try again." });
  }

  try {
    const result = await pool.query(
      "SELECT id, name, email, role, status FROM users WHERE id = $1",
      [claims.id]
    );
    const user = result.rows[0];
    if (!user || (user.status && user.status !== "active")) {
      return res.status(403).json({ message: "This account is not active" });
    }
    res.json({
      accessToken: createUserToken(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    console.error("GOOGLE SIGN-IN COMPLETION ERROR:", error);
    res.status(500).json({ message: "Google sign-in could not be completed." });
  }
});

module.exports = router;