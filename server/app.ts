import express from 'express'
import cookieParser from 'cookie-parser'
import crypto from 'node:crypto'
import authRoutes from './routes/auth.js'
import adminRoutes from './routes/admin.js'
import learningRoutes from './routes/learning.js'
import uploadRoutes from './routes/uploads.js'
import studentRoutes from './routes/student.js'
import aiRoutes from './routes/ai.js'
import teacherRoutes from './routes/teacher.js'
import { applySecurity } from './middleware/security.js'
import { errorHandler, notFound } from './middleware/errors.js'

export function createApp() {
    const app = express()
    app.use((request, response, next) => { response.setHeader('x-request-id', request.headers['x-request-id'] || crypto.randomUUID()); next() })
    applySecurity(app)
    app.use(express.json({ limit: '1mb' }))
    app.use(express.urlencoded({ extended: false, limit: '100kb' }))
    app.use(cookieParser())
    app.get('/health', (_request, response) => response.json({ status: 'ok', service: 'edusphere-api' }))
    app.use('/api/auth', authRoutes)
    app.use('/api/learning', learningRoutes)
    app.use('/api/admin', adminRoutes)
    app.use('/api/uploads', uploadRoutes)
    app.use('/api/student', studentRoutes)
    app.use('/api/ai', aiRoutes)
    app.use('/api/teacher', teacherRoutes)
    app.use(notFound)
    app.use(errorHandler)
    return app
}
