const express = require("express");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const pool = require("../db");

const router = express.Router();
const allowedTypes = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => callback(null, allowedTypes.has(file.mimetype)),
});

function requireAdmin(req, res, next) {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return res.status(401).json({ message: "Authentication required" });
    try {
        const claims = jwt.verify(header.slice(7), process.env.JWT_SECRET);
        req.auth = { userId: claims.id || claims.sub, role: claims.role || "student" };
        if (!["admin", "super-admin"].includes(req.auth.role)) return res.status(403).json({ message: "Administrator access required" });
        pool.query("SELECT role, status FROM users WHERE id = $1", [req.auth.userId]).then((result) => {
            const user = result.rows[0];
            if (!user || user.status !== "active" || !["admin", "super-admin"].includes(user.role)) return res.status(403).json({ message: "Active administrator access required" });
            req.auth.role = user.role;
            return next();
        }).catch((error) => {
            console.error("SUBJECT NOTE UPLOAD AUTH ERROR:", error.message);
            return res.status(500).json({ message: "Administrator access could not be verified." });
        });
    } catch {
        return res.status(401).json({ message: "Your session has expired" });
    }
}

router.post("/subject-note-attachments", requireAdmin, upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Choose a supported file under 15 MB." });
    try {
        const name = req.file.originalname.replace(/[\r\n"]/g, "_").slice(0, 255);
        const result = await pool.query(`INSERT INTO subject_note_attachments (created_by, name, mime_type, size_bytes, file_data)
            VALUES ($1, $2, $3, $4, $5) RETURNING id, name, mime_type AS type, size_bytes AS size`, [
            req.auth.userId, name, req.file.mimetype, req.file.size, req.file.buffer,
        ]);
        return res.status(201).json({ data: { ...result.rows[0], size: Number(result.rows[0].size) } });
    } catch (error) {
        console.error("SUBJECT NOTE FILE UPLOAD ERROR:", error.message);
        return res.status(500).json({ message: "The attachment could not be uploaded." });
    }
});

module.exports = router;
