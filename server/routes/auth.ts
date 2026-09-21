import { Router } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { env } from '../config.js'
import { HttpError, asyncHandler } from '../errors.js'
import { authRateLimit } from '../middleware/security.js'
import { signAccessToken } from '../middleware/auth.js'

const router = Router()
const passwordSchema = z.string().min(12, 'Password must be at least 12 characters').max(128)
const credentialsSchema = z.object({ email: z.string().email().transform((value) => value.toLowerCase()), password: passwordSchema, fullName: z.string().min(2).max(120).optional() })

function hashToken(token: string) { return crypto.createHash('sha256').update(token).digest('hex') }
async function issueRefreshToken(userId: string) {
    const rawToken = crypto.randomBytes(48).toString('base64url')
    await pool.query('INSERT INTO refresh_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'30 days\')', [userId, hashToken(rawToken)])
    return rawToken
}

router.post('/register', authRateLimit, asyncHandler(async (request, response) => {
    const input = credentialsSchema.parse(request.body)
    const passwordHash = await bcrypt.hash(input.password, 12)
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const userResult = await client.query('INSERT INTO users (email, password_hash, full_name, status, email_verified_at) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, full_name, role, status', [input.email, passwordHash, input.fullName || input.email.split('@')[0], env.NODE_ENV === 'development' ? 'active' : 'pending', env.NODE_ENV === 'development' ? new Date() : null])
        await client.query('INSERT INTO students (user_id) VALUES ($1)', [userResult.rows[0].id])
        await client.query('COMMIT')
        const verificationToken = crypto.randomBytes(32).toString('base64url')
        if (env.NODE_ENV !== 'development') await pool.query("INSERT INTO auth_tokens (user_id, token_hash, purpose, expires_at) VALUES ($1, $2, 'email-verification', now() + interval '24 hours')", [userResult.rows[0].id, hashToken(verificationToken)])
        response.status(201).json({ user: userResult.rows[0], message: env.NODE_ENV === 'development' ? 'Account created. You can sign in now.' : 'Account created. Verify your email before signing in.', verificationToken: env.NODE_ENV === 'development' ? undefined : verificationToken })
    } catch (error) { await client.query('ROLLBACK'); if ((error as { code?: string }).code === '23505') throw new HttpError(409, 'An account with that email already exists'); throw error } finally { client.release() }
}))

router.post('/login', authRateLimit, asyncHandler(async (request, response) => {
    const input = credentialsSchema.pick({ email: true, password: true }).parse(request.body)
    const result = await pool.query('SELECT id, email, full_name, password_hash, role, status, email_verified_at FROM users WHERE email = $1', [input.email])
    const user = result.rows[0]
    if (!user || !(await bcrypt.compare(input.password, user.password_hash))) throw new HttpError(401, 'Invalid email or password')
    if (user.status === 'suspended') throw new HttpError(403, 'This account is suspended')
    if (!user.email_verified_at) throw new HttpError(403, 'Verify your email before signing in')
    await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id])
    const refreshToken = await issueRefreshToken(user.id)
    response.cookie('edusphere_refresh', refreshToken, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: env.COOKIE_SAME_SITE, maxAge: 30 * 24 * 60 * 60 * 1000 })
    response.json({ accessToken: signAccessToken(user.id, user.role), user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role } })
}))

router.post('/refresh', asyncHandler(async (request, response) => {
    const rawToken = request.cookies?.edusphere_refresh
    if (!rawToken) throw new HttpError(401, 'Refresh session not found')
    const result = await pool.query('SELECT rs.id, rs.user_id, u.role FROM refresh_sessions rs JOIN users u ON u.id = rs.user_id WHERE rs.token_hash = $1 AND rs.revoked_at IS NULL AND rs.expires_at > now()', [hashToken(rawToken)])
    const session = result.rows[0]
    if (!session) throw new HttpError(401, 'Refresh session expired')
    await pool.query('UPDATE refresh_sessions SET revoked_at = now() WHERE id = $1', [session.id])
    const nextToken = await issueRefreshToken(session.user_id)
    response.cookie('edusphere_refresh', nextToken, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: env.COOKIE_SAME_SITE, maxAge: 30 * 24 * 60 * 60 * 1000 })
    response.json({ accessToken: signAccessToken(session.user_id, session.role) })
}))

router.post('/logout', asyncHandler(async (request, response) => { const token = request.cookies?.edusphere_refresh; if (token) await pool.query('UPDATE refresh_sessions SET revoked_at = now() WHERE token_hash = $1', [hashToken(token)]); response.clearCookie('edusphere_refresh', { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: env.COOKIE_SAME_SITE }); response.status(204).send() }))

router.post('/verify-email', asyncHandler(async (request, response) => { const token = z.string().min(32).parse(request.body.token); const result = await pool.query("UPDATE auth_tokens SET consumed_at = now() WHERE token_hash = $1 AND purpose = 'email-verification' AND consumed_at IS NULL AND expires_at > now() RETURNING user_id", [hashToken(token)]); if (!result.rowCount) throw new HttpError(400, 'Invalid or expired verification token'); await pool.query('UPDATE users SET email_verified_at = coalesce(email_verified_at, now()), status = \'active\' WHERE id = $1', [result.rows[0].user_id]); response.json({ message: 'Email verified' }) }))

router.post('/forgot-password', authRateLimit, asyncHandler(async (request, response) => { const email = z.string().email().transform((value) => value.toLowerCase()).parse(request.body.email); const result = await pool.query('SELECT id FROM users WHERE email = $1', [email]); if (result.rows[0]) { const token = crypto.randomBytes(32).toString('base64url'); await pool.query("INSERT INTO auth_tokens (user_id, token_hash, purpose, expires_at) VALUES ($1, $2, 'password-reset', now() + interval '30 minutes')", [result.rows[0].id, hashToken(token)]); } response.json({ message: 'If an account exists, reset instructions have been sent.' }) }))
router.post('/reset-password', authRateLimit, asyncHandler(async (request, response) => { const input = z.object({ token: z.string().min(32), password: passwordSchema }).parse(request.body); const passwordHash = await bcrypt.hash(input.password, 12); const result = await pool.query("UPDATE auth_tokens SET consumed_at = now() WHERE token_hash = $1 AND purpose = 'password-reset' AND consumed_at IS NULL AND expires_at > now() RETURNING user_id", [hashToken(input.token)]); if (!result.rowCount) throw new HttpError(400, 'Invalid or expired reset token'); await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, result.rows[0].user_id]); await pool.query('UPDATE refresh_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [result.rows[0].user_id]); response.json({ message: 'Password reset successfully' }) }))

export default router
