import { Router } from 'express'
import multer from 'multer'
import { pool } from '../db/pool.js'
import { HttpError, asyncHandler } from '../errors.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'

const router = Router()
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
    fileFilter: (_request, file, callback) => {
        const allowed = new Set([
            'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ])
        if (allowed.has(file.mimetype)) callback(null, true)
        else callback(new HttpError(415, 'Unsupported file type'))
    },
})

router.post('/subject-note-attachments', requireAuth, requirePermission('system.manage'), upload.single('file'), asyncHandler(async (request, response) => {
    if (!request.file) throw new HttpError(400, 'A file is required')
    const actor = await pool.query("SELECT role, status FROM users WHERE id = $1", [request.auth!.userId])
    if (!actor.rows[0] || !['admin', 'super-admin'].includes(actor.rows[0].role) || actor.rows[0].status !== 'active') {
        throw new HttpError(403, 'Active administrator access required')
    }
    const name = request.file.originalname.replace(/[\r\n"]/g, '_').slice(0, 255)
    const result = await pool.query(`INSERT INTO subject_note_attachments (created_by, name, mime_type, size_bytes, file_data)
        VALUES ($1, $2, $3, $4, $5) RETURNING id, name, mime_type AS type, size_bytes AS size`, [
        request.auth!.userId, name, request.file.mimetype, request.file.size, request.file.buffer,
    ])
    response.status(201).json({ data: { ...result.rows[0], size: Number(result.rows[0].size) } })
}))


export default router
