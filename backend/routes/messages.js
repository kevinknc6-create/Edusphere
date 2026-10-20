const express = require("express");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();
const idPattern = /^\d+$/;

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

function positiveId(value) {
    return idPattern.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
}

router.use(requireAuth, async (req, res, next) => {
    try {
        const result = await pool.query("SELECT 1 FROM users WHERE id = $1 AND status = 'active'", [req.auth.userId]);
        if (!result.rows[0]) return res.status(403).json({ message: "Active account required." });
        next();
    } catch (error) {
        console.error("MESSAGE AUTH ERROR:", error.message);
        res.status(500).json({ message: "Messaging is temporarily unavailable." });
    }
});

router.get("/", async (req, res) => {
    try {
        const result = await pool.query(`SELECT c.id, c.subject, p.id AS participant_id, p.name, p.role,
            count(m.id) FILTER (WHERE m.sender_id <> $1 AND m.read_at IS NULL)::int > 0 AS unread,
            COALESCE(json_agg(json_build_object(
                'id', m.id,
                'me', m.sender_id = $1,
                'text', m.body,
                'ts', floor(extract(epoch FROM m.created_at) * 1000)
            ) ORDER BY m.created_at) FILTER (WHERE m.id IS NOT NULL), '[]'::json) AS msgs
            FROM admin_conversations c
            JOIN users p ON p.id = CASE WHEN c.created_by = $1 THEN c.recipient_id ELSE c.created_by END
            LEFT JOIN admin_messages m ON m.conversation_id = c.id
            WHERE c.created_by = $1 OR c.recipient_id = $1
            GROUP BY c.id, p.id ORDER BY c.updated_at DESC`, [req.auth.userId]);
        res.json({ data: result.rows });
    } catch (error) {
        console.error("MESSAGES LIST ERROR:", error.message);
        res.status(500).json({ message: "Messages are temporarily unavailable. Apply the legacy admin dashboard migration if it has not been run." });
    }
});

router.patch("/:conversationId/read", async (req, res) => {
    const conversationId = positiveId(req.params.conversationId);
    if (!conversationId) return res.status(400).json({ message: "Invalid conversation ID." });
    try {
        const result = await pool.query(`UPDATE admin_messages SET read_at = now()
            WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL
              AND EXISTS (SELECT 1 FROM admin_conversations c WHERE c.id = $1 AND (c.created_by = $2 OR c.recipient_id = $2))
            RETURNING id`, [conversationId, req.auth.userId]);
        const conversation = await pool.query("SELECT 1 FROM admin_conversations WHERE id = $1 AND (created_by = $2 OR recipient_id = $2)", [conversationId, req.auth.userId]);
        if (!conversation.rows[0]) return res.status(404).json({ message: "Conversation not found." });
        res.json({ data: result.rows });
    } catch (error) {
        console.error("MESSAGES READ ERROR:", error.message);
        res.status(500).json({ message: "Messages could not be marked as read." });
    }
});

router.post("/", async (req, res) => {
    const recipientId = positiveId(req.body.recipientId);
    const subject = typeof req.body.subject === "string" ? req.body.subject.trim() : "";
    const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
    if (!recipientId || subject.length > 160 || body.length < 1 || body.length > 5000) return res.status(400).json({ message: "Choose a recipient and enter a message of up to 5,000 characters." });
    if (String(recipientId) === String(req.auth.userId)) return res.status(400).json({ message: "You cannot message yourself." });
    try {
        const recipient = await pool.query("SELECT id FROM users WHERE id = $1 AND status = 'active'", [recipientId]);
        if (!recipient.rows[0]) return res.status(404).json({ message: "Active recipient not found." });
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            let conversation = await client.query(`SELECT id FROM admin_conversations
                WHERE (created_by = $1 AND recipient_id = $2) OR (created_by = $2 AND recipient_id = $1)
                ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`, [req.auth.userId, recipientId]);
            if (!conversation.rows[0]) conversation = await client.query("INSERT INTO admin_conversations (subject, created_by, recipient_id) VALUES ($1,$2,$3) RETURNING id", [subject, req.auth.userId, recipientId]);
            const conversationId = conversation.rows[0].id;
            const message = await client.query("INSERT INTO admin_messages (conversation_id, sender_id, body) VALUES ($1,$2,$3) RETURNING id, sender_id, body, created_at", [conversationId, req.auth.userId, body]);
            await client.query("UPDATE admin_conversations SET updated_at = now() WHERE id = $1", [conversationId]);
            await client.query("INSERT INTO admin_notifications (user_id, title, body) VALUES ($1, 'New message', $2)", [recipientId, body.slice(0, 240)]);
            await client.query("COMMIT");
            res.status(201).json({ data: { conversationId, message: message.rows[0] } });
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error("MESSAGE CREATE ERROR:", error.message);
        res.status(500).json({ message: "Message could not be sent." });
    }
});

router.post("/:conversationId/messages", async (req, res) => {
    const conversationId = positiveId(req.params.conversationId);
    const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
    if (!conversationId || body.length < 1 || body.length > 5000) return res.status(400).json({ message: "Enter a valid message of up to 5,000 characters." });
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const conversation = await client.query("SELECT id, created_by, recipient_id FROM admin_conversations WHERE id = $1 AND (created_by = $2 OR recipient_id = $2) FOR UPDATE", [conversationId, req.auth.userId]);
        if (!conversation.rows[0]) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Conversation not found." });
        }
        const message = await client.query("INSERT INTO admin_messages (conversation_id, sender_id, body) VALUES ($1,$2,$3) RETURNING id, sender_id, body, created_at", [conversationId, req.auth.userId, body]);
        const recipientId = String(conversation.rows[0].created_by) === String(req.auth.userId) ? conversation.rows[0].recipient_id : conversation.rows[0].created_by;
        await client.query("UPDATE admin_conversations SET updated_at = now() WHERE id = $1", [conversationId]);
        await client.query("INSERT INTO admin_notifications (user_id, title, body) VALUES ($1, 'New message', $2)", [recipientId, body.slice(0, 240)]);
        await client.query("COMMIT");
        res.status(201).json({ data: message.rows[0] });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("MESSAGE REPLY ERROR:", error.message);
        res.status(500).json({ message: "Reply could not be sent." });
    } finally {
        client.release();
    }
});

module.exports = router;
