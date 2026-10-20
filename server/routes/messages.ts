import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { asyncHandler, HttpError } from '../errors.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
const id = z.string().uuid()
router.use(requireAuth, asyncHandler(async (request, _response, next) => {
    const active = await pool.query("SELECT 1 FROM users WHERE id = $1 AND status = 'active'", [request.auth!.userId])
    if (!active.rows[0]) throw new HttpError(403, 'Active account required')
    next()
}))

router.get('/', asyncHandler(async (request, response) => {
    const userId = request.auth!.userId
    const result = await pool.query(`
        SELECT c.id, c.subject, p.id AS participant_id, p.full_name AS name, p.role,
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
        GROUP BY c.id, c.subject, c.updated_at, p.id, p.full_name, p.role
        ORDER BY c.updated_at DESC`)
    response.json({ data: result.rows })
}))

router.patch('/:conversationId/read', asyncHandler(async (request, response) => {
    const conversationId = id.parse(request.params.conversationId)
    const userId = request.auth!.userId
    const result = await pool.query(`
        UPDATE admin_messages SET read_at = now()
        WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL
          AND EXISTS (SELECT 1 FROM admin_conversations c WHERE c.id = $1 AND (c.created_by = $2 OR c.recipient_id = $2))
        RETURNING id`, [conversationId, userId])
    const exists = await pool.query('SELECT 1 FROM admin_conversations WHERE id = $1 AND (created_by = $2 OR recipient_id = $2)', [conversationId, userId])
    if (!exists.rows[0]) throw new HttpError(404, 'Conversation not found')
    response.json({ data: result.rows })
}))

router.post('/', asyncHandler(async (request, response) => {
    const input = z.object({ recipientId: id, subject: z.string().trim().max(160).default(''), body: z.string().trim().min(1).max(5000) }).parse(request.body)
    const senderId = request.auth!.userId
    if (input.recipientId === senderId) throw new HttpError(400, 'You cannot message yourself')
    const recipient = await pool.query("SELECT id FROM users WHERE id = $1 AND status = 'active' AND role IN ('student', 'teacher', 'admin', 'super-admin')", [input.recipientId])
    if (!recipient.rows[0]) throw new HttpError(404, 'Active recipient not found')
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        let conversation = await client.query(`
            SELECT id FROM admin_conversations
            WHERE (created_by = $1 AND recipient_id = $2) OR (created_by = $2 AND recipient_id = $1)
            ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`, [senderId, input.recipientId])
        if (!conversation.rows[0]) {
            conversation = await client.query('INSERT INTO admin_conversations (subject, created_by, recipient_id) VALUES ($1, $2, $3) RETURNING id', [input.subject, senderId, input.recipientId])
        }
        const conversationId = conversation.rows[0].id
        const message = await client.query('INSERT INTO admin_messages (conversation_id, sender_id, body) VALUES ($1, $2, $3) RETURNING id, sender_id, body, created_at', [conversationId, senderId, input.body])
        await client.query('UPDATE admin_conversations SET updated_at = now() WHERE id = $1', [conversationId])
        await client.query('INSERT INTO notifications (user_id, title, body) VALUES ($1, $2, $3)', [input.recipientId, 'New message', input.body.slice(0, 240)])
        await client.query('COMMIT')
        response.status(201).json({ data: { conversationId, message: message.rows[0] } })
    } catch (error) {
        await client.query('ROLLBACK')
        throw error
    } finally {
        client.release()
    }
}))

router.post('/:conversationId/messages', asyncHandler(async (request, response) => {
    const conversationId = id.parse(request.params.conversationId)
    const body = z.string().trim().min(1).max(5000).parse(request.body.body)
    const userId = request.auth!.userId
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const conversation = await client.query('SELECT id, created_by, recipient_id FROM admin_conversations WHERE id = $1 AND (created_by = $2 OR recipient_id = $2) FOR UPDATE', [conversationId, userId])
        if (!conversation.rows[0]) throw new HttpError(404, 'Conversation not found')
        const message = await client.query('INSERT INTO admin_messages (conversation_id, sender_id, body) VALUES ($1, $2, $3) RETURNING id, sender_id, body, created_at', [conversationId, userId, body])
        const recipientId = conversation.rows[0].created_by === userId ? conversation.rows[0].recipient_id : conversation.rows[0].created_by
        await client.query('UPDATE admin_conversations SET updated_at = now() WHERE id = $1', [conversationId])
        await client.query('INSERT INTO notifications (user_id, title, body) VALUES ($1, $2, $3)', [recipientId, 'New message', body.slice(0, 240)])
        await client.query('COMMIT')
        response.status(201).json({ data: message.rows[0] })
    } catch (error) {
        await client.query('ROLLBACK')
        throw error
    } finally {
        client.release()
    }
}))

export default router
