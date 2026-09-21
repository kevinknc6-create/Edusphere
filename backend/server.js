const express = require("express");
const cors = require("cors");
require("dotenv").config();

const pool = require("./db");
const authRoutes = require("./routes/auth");
const aiRoutes = require("./routes/ai");
const learningRoutes = require("./routes/learning");
const studentRoutes = require("./routes/student");

const app = express();
app.get("/health", (_req, res) => res.json({ status: "ok", service: "edusphere-legacy-api" }));

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/learning", learningRoutes);
app.use("/api/student", studentRoutes);

app.get("/", (req, res) => {
  res.json({ message: "Edusphere API is running" });
});

app.get("/api/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.json({
      success: true,
      message: "Database connected successfully",
      time: result.rows[0].now,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Database connection failed",
    });
  }
});

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});