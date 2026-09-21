import { Router } from 'express'
import multer from 'multer'
import { HttpError, asyncHandler } from '../errors.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'

const router = Router()
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (_request, file, callback) => {
        const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4'])
        if (allowed.has(file.mimetype)) callback(null, true)
        else callback(new HttpError(415, 'Unsupported file type'))
    },
})

router.post('/', requireAuth, requirePermission('system.manage'), upload.single('file'), asyncHandler(async (request, response) => {
    if (!request.file) throw new HttpError(400, 'A file is required')
    // The API validates the upload before handing it to an object-storage adapter.
    response.status(202).json({ message: 'Upload accepted for storage processing', file: { name: request.file.originalname, type: request.file.mimetype, size: request.file.size } })
}))

export default router
