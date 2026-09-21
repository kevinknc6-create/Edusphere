const express = require("express");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();
const requestCounts = new Map();

function requireAuth(req, res, next) {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return res.status(401).json({ message: "Authentication required" });
    try {
        const claims = jwt.verify(header.slice(7), process.env.JWT_SECRET);
        req.auth = { userId: claims.id || claims.sub, role: claims.role || "student" };
        next();
    } catch {
        res.status(401).json({ message: "Your session has expired" });
    }
}

function rateLimit(req, res, next) {
    const now = Date.now();
    const key = req.auth.userId;
    const current = requestCounts.get(key);
    if (!current || now - current.startedAt > 15 * 60 * 1000) {
        requestCounts.set(key, { startedAt: now, count: 1 });
        return next();
    }
    if (current.count >= 30) return res.status(429).json({ message: "Edusphere AI is temporarily unavailable. Please try again later." });
    current.count += 1;
    next();
}

function cleanText(value, maxLength) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function askProvider(messages) {
    if (!process.env.AI_API_KEY) throw new Error("AI_NOT_CONFIGURED");
    const response = await fetch(process.env.AI_API_URL || "https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AI_API_KEY}` },
        body: JSON.stringify({ model: process.env.AI_MODEL || "gpt-4o-mini", messages, temperature: 0.3 }),
        signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error("AI_PROVIDER_FAILED");
    const payload = await response.json();
    const answer = payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
    if (!answer || !answer.trim()) throw new Error("AI_EMPTY_RESPONSE");
    return answer.trim();
}

function unavailable(res) {
    return res.status(503).json({ message: "Edusphere AI is temporarily unavailable. Please try again." });
}

router.use(requireAuth, rateLimit);

router.post("/chat", async (req, res) => {
    const message = cleanText(req.body.message, 4000);
    if (!message) return res.status(400).json({ message: "Please enter a question for Edusphere AI." });
    const educationLevel = cleanText(req.body.educationLevel, 120) || "the learner's current education level";
    const language = cleanText(req.body.language, 40) || "English";
    const context = [
        ["Education level", educationLevel],
        ["Class or program", cleanText(req.body.classProgram, 160)],
        ["Subject", cleanText(req.body.subject, 120)],
        ["Course", cleanText(req.body.course, 160)],
        ["Module", cleanText(req.body.module, 160)],
        ["Lesson", cleanText(req.body.lesson, 200)],
    ].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join("\n");
    try {
        const answer = await askProvider([
            { role: "system", content: `You are Edusphere AI, a patient learning assistant. Adapt explanations to ${educationLevel}. Use clear examples, check understanding, and answer in ${language}. Use the following lesson context when relevant:\n${context || "No lesson context was supplied."}` },
            { role: "user", content: message },
        ]);
        res.json({ data: { conversationId: null, answer } });
    } catch (error) {
        console.error("EDUSPHERE AI ERROR:", error.message);
        unavailable(res);
    }
});

router.post("/generate", async (req, res) => {
    if (!["teacher", "admin", "super-admin"].includes(req.auth.role)) return res.status(403).json({ message: "Teacher access required" });
    const kind = cleanText(req.body.kind, 60);
    const topic = cleanText(req.body.topic, 500);
    if (!kind || !topic) return res.status(400).json({ message: "A content type and topic are required." });
    const educationLevel = cleanText(req.body.educationLevel, 120) || "the requested learner level";
    const language = cleanText(req.body.language, 40) || "English";
    try {
        const markdown = await askProvider([
            { role: "system", content: `Create an editable ${kind} draft for a teacher. Use clear headings, accurate classroom-ready content, and answer keys where relevant. Never claim it is published. Adapt it to ${educationLevel} and write in ${language}.` },
            { role: "user", content: `Topic: ${topic}\nAdditional instructions: ${cleanText(req.body.instructions, 2000) || "Use practical examples and appropriate assessment difficulty."}` },
        ]);
        const saved = await pool.query("INSERT INTO teacher_content_drafts (teacher_id, kind, title, content) VALUES ($1, $2, $3, $4) RETURNING id, kind, title, content, status, created_at, updated_at", [req.auth.userId, kind, topic, JSON.stringify({ markdown })]);
        res.status(201).json({ data: saved.rows[0] });
    } catch (error) {
        console.error("EDUSPHERE AI ERROR:", error.message);
        unavailable(res);
    }
});

router.get("/drafts", async (req, res) => {
    if (!["teacher", "admin", "super-admin"].includes(req.auth.role)) return res.status(403).json({ message: "Teacher access required" });
    const result = await pool.query("SELECT id, kind, title, content, status, created_at, updated_at FROM teacher_content_drafts WHERE teacher_id = $1 ORDER BY updated_at DESC", [req.auth.userId]);
    res.json({ data: result.rows });
});

router.patch("/drafts/:id", async (req, res) => {
    if (!["teacher", "admin", "super-admin"].includes(req.auth.role)) return res.status(403).json({ message: "Teacher access required" });
    const title = cleanText(req.body.title, 240);
    const markdown = cleanText(req.body.markdown, 20000);
    if (!title || !markdown) return res.status(400).json({ message: "Draft title and content are required" });
    const result = await pool.query("UPDATE teacher_content_drafts SET title = $1, content = $2, updated_at = now() WHERE id = $3 AND teacher_id = $4 RETURNING id, kind, title, content, status, updated_at", [title, JSON.stringify({ markdown }), req.params.id, req.auth.userId]);
    if (!result.rows[0]) return res.status(404).json({ message: "Draft not found" });
    res.json({ data: result.rows[0] });
});

router.post("/drafts/:id/publish", async (req, res) => {
    if (!["teacher", "admin", "super-admin"].includes(req.auth.role)) return res.status(403).json({ message: "Teacher access required" });
    const result = await pool.query("UPDATE teacher_content_drafts SET status = 'published', updated_at = now() WHERE id = $1 AND teacher_id = $2 RETURNING id, kind, title, content, status, updated_at", [req.params.id, req.auth.userId]);
    if (!result.rows[0]) return res.status(404).json({ message: "Draft not found" });
    res.json({ data: result.rows[0] });
});

module.exports = router;