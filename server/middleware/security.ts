import cors from 'cors'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import type { Express } from 'express'
import { env } from '../config.js'

export function applySecurity(app: Express) {
    app.disable('x-powered-by')
    app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
    const allowedOrigins = [...new Set(['http://localhost:5173', 'http://127.0.0.1:5173', ...env.CLIENT_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)])]
    app.use(cors({ origin: (origin, callback) => { if (!origin || allowedOrigins.includes(origin)) callback(null, true); else callback(new Error('Origin is not allowed')) }, credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'] }))
    app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }))
}

export const authRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false })
