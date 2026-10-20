const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();

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

module.exports = router;