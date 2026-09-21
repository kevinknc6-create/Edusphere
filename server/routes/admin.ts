import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { asyncHandler } from '../errors.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

router.get('/overview', requirePermission('system.manage'), asyncHandler(async (_request, response) => {
    const result = await pool.query(`SELECT (SELECT count(*) FROM students) AS students, (SELECT count(*) FROM teachers) AS teachers, (SELECT count(*) FROM courses) AS courses, (SELECT count(*) FROM subjects) AS subjects, (SELECT count(*) FROM courses WHERE status = 'pending') AS pending_courses`)
    response.json({ data: result.rows[0] })
}))

router.get('/users', requirePermission('users.view'), asyncHandler(async (request, response) => {
    const query = z.string().max(120).optional().parse(request.query.search)
    const result = await pool.query('SELECT id, email, full_name, role, status, created_at, last_login_at FROM users WHERE ($1::text IS NULL OR full_name ILIKE $1 OR email ILIKE $1) ORDER BY created_at DESC LIMIT 100', [query ? `%${query}%` : null])
    response.json({ data: result.rows })
}))

router.patch('/users/:id/status', requirePermission('users.manage'), asyncHandler(async (request, response) => {
    const status = z.enum(['active', 'suspended']).parse(request.body.status)
    const result = await pool.query('UPDATE users SET status = $1 WHERE id = $2 RETURNING id, email, full_name, role, status', [status, request.params.id])
    response.json({ data: result.rows[0] })
}))

router.get('/moderation', requirePermission('courses.moderate'), asyncHandler(async (_request, response) => { const result = await pool.query('SELECT c.id, c.title, c.status, c.created_at, u.full_name AS teacher FROM courses c JOIN users u ON u.id = c.teacher_id WHERE c.status IN (\'pending\', \'rejected\') ORDER BY c.created_at DESC'); response.json({ data: result.rows }) }))
router.patch('/moderation/courses/:id', requirePermission('courses.moderate'), asyncHandler(async (request, response) => { const status = z.enum(['approved', 'rejected', 'published', 'draft']).parse(request.body.status); const result = await pool.query('UPDATE courses SET status = $1, approved_by = $2 WHERE id = $3 RETURNING id, title, status', [status, request.auth?.userId, request.params.id]); response.json({ data: result.rows[0] }) }))
router.get('/audit-logs', requirePermission('audit.view'), asyncHandler(async (_request, response) => { const result = await pool.query('SELECT id, actor_id, action, entity_type, entity_id, metadata, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 200'); response.json({ data: result.rows }) }))

export default router
