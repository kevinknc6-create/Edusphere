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
const credentialsSchema = z.object({ email: z.string().trim().email().transform((value) => value.toLowerCase()), password: passwordSchema, fullName: z.string().trim().min(2).max(120).optional() })
const registrationSchema = credentialsSchema.extend({ fullName: z.string().trim().min(2).max(120) })
const passwordResetRequestSchema = z.object({ email: z.string().trim().email().transform((value) => value.toLowerCase()), fullName: z.string().trim().min(2).max(120) })
const passwordCodeSchema = passwordResetRequestSchema.extend({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit verification code') })
const teacherEmailSchema = z.object({ email: z.string().trim().email().transform((value) => value.toLowerCase()) })
const teacherCodeSchema = teacherEmailSchema.extend({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit verification code') })

function hashToken(token: string) { return crypto.createHash('sha256').update(token).digest('hex') }
function createVerificationCode() { return crypto.randomInt(100000, 1000000).toString() }
async function sendPasswordResetCode(email: string, code: string) {
    if (!env.RESEND_API_KEY) {
        if (env.NODE_ENV === 'development') { console.info(`[development] Password reset code for ${email}: ${code}`); return }
        throw new HttpError(503, 'Password reset email service is not configured')
    }
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.MAIL_FROM, to: [email], subject: 'Your EduSphere password reset code', text: `Your EduSphere password reset code is ${code}. It expires in 10 minutes.` }) })
    if (!response.ok) throw new HttpError(503, 'Password reset email could not be sent')
}
async function sendTeacherVerificationCode(email: string, code: string) {
    if (!env.RESEND_API_KEY) {
        if (env.NODE_ENV === 'development') { console.info(`[development] Teacher verification code for ${email}: ${code}`); return }
        throw new HttpError(503, 'Teacher verification email service is not configured')
    }
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.MAIL_FROM, to: [email], subject: 'Your EduSphere teacher verification code', text: `Your EduSphere teacher verification code is ${code}. It expires in 10 minutes.` }) })
    if (!response.ok) throw new HttpError(503, 'Teacher verification email could not be sent')
}
async function issueRefreshToken(userId: string) {
    const rawToken = crypto.randomBytes(48).toString('base64url')
    await pool.query('INSERT INTO refresh_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'30 days\')', [userId, hashToken(rawToken)])
    return rawToken
}

export async function issueTeacherVerificationCode(teacherId: string, createdBy: string | null = null) {
    const teacher = await pool.query(`SELECT u.email, t.teacher_verification_status FROM teachers t JOIN users u ON u.id = t.user_id WHERE t.user_id = $1`, [teacherId])
    if (!teacher.rows[0]) throw new HttpError(404, 'Teacher not found')
    if (!['approved', 'verified'].includes(teacher.rows[0].teacher_verification_status)) throw new HttpError(409, 'Teacher must be approved before verification')
    const code = createVerificationCode()
    const codeHash = await bcrypt.hash(code, 12)
    await pool.query('UPDATE teacher_verification_codes SET invalidated_at = now() WHERE teacher_id = $1 AND consumed_at IS NULL AND invalidated_at IS NULL', [teacherId])
    await pool.query(`INSERT INTO teacher_verification_codes (teacher_id, code_hash, expires_at, created_by) VALUES ($1, $2, now() + interval '10 minutes', $3)`, [teacherId, codeHash, createdBy])
    await sendTeacherVerificationCode(teacher.rows[0].email, code)
}

router.post('/register', authRateLimit, asyncHandler(async (request, response) => {
    const input = registrationSchema.parse(request.body)
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
    if (user.role === 'teacher') throw new HttpError(403, 'Use Teacher Sign In to access your teacher account')
    if (user.status === 'suspended') throw new HttpError(403, 'This account is suspended')
    if (!user.email_verified_at) throw new HttpError(403, 'Verify your email before signing in')
    await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id])
    const refreshToken = await issueRefreshToken(user.id)
    response.cookie('edusphere_refresh', refreshToken, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: env.COOKIE_SAME_SITE, maxAge: 30 * 24 * 60 * 60 * 1000 })
    response.json({ accessToken: signAccessToken(user.id, user.role), user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role } })
}))

router.post('/teacher/request-code', authRateLimit, asyncHandler(async (request, response) => {
    const input = teacherEmailSchema.parse(request.body)
    const result = await pool.query(`SELECT t.user_id, t.teacher_verification_status FROM teachers t JOIN users u ON u.id = t.user_id WHERE u.email = $1 AND u.role = 'teacher'`, [input.email])
    if (!result.rows[0]) throw new HttpError(403, 'This email is not an eligible teacher account')
    if (result.rows[0].teacher_verification_status === 'suspended' || result.rows[0].teacher_verification_status === 'rejected' || result.rows[0].teacher_verification_status === 'pending') throw new HttpError(403, 'This teacher account is not approved')
    await issueTeacherVerificationCode(result.rows[0].user_id)
    response.json({ message: 'A verification code was sent to the approved teacher email.' })
}))

router.post('/teacher/verify-code', authRateLimit, asyncHandler(async (request, response) => {
    const input = teacherCodeSchema.parse(request.body)
    const teacher = await pool.query(`SELECT u.id, u.email, u.full_name, u.status, t.teacher_verification_status FROM users u JOIN teachers t ON t.user_id = u.id WHERE u.email = $1 AND u.role = 'teacher'`, [input.email])
    if (!teacher.rows[0] || !['approved', 'verified'].includes(teacher.rows[0].teacher_verification_status) || teacher.rows[0].status === 'suspended') throw new HttpError(403, 'Teacher account is not eligible')
    const codeResult = await pool.query(`SELECT id, code_hash, attempts, expires_at FROM teacher_verification_codes WHERE teacher_id = $1 AND consumed_at IS NULL AND invalidated_at IS NULL ORDER BY created_at DESC LIMIT 1`, [teacher.rows[0].id])
    const code = codeResult.rows[0]
    if (!code || new Date(code.expires_at).getTime() <= Date.now() || code.attempts >= 5) throw new HttpError(401, 'Verification code is invalid or expired')
    if (!(await bcrypt.compare(input.code, code.code_hash))) {
        await pool.query('UPDATE teacher_verification_codes SET attempts = attempts + 1 WHERE id = $1', [code.id])
        throw new HttpError(401, 'Verification code is invalid or expired')
    }
    await pool.query('UPDATE teacher_verification_codes SET consumed_at = now() WHERE id = $1', [code.id])
    await pool.query(`UPDATE teachers SET teacher_verification_status = 'verified', verification_status = 'active', approved_at = COALESCE(approved_at, now()) WHERE user_id = $1`, [teacher.rows[0].id])
    await pool.query('UPDATE users SET status = \'active\', last_login_at = now() WHERE id = $1', [teacher.rows[0].id])
    const refreshToken = await issueRefreshToken(teacher.rows[0].id)
    response.cookie('edusphere_refresh', refreshToken, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: env.COOKIE_SAME_SITE, maxAge: 30 * 24 * 60 * 60 * 1000 })
    response.json({ accessToken: signAccessToken(teacher.rows[0].id, 'teacher'), user: { id: teacher.rows[0].id, email: teacher.rows[0].email, fullName: teacher.rows[0].full_name, role: 'teacher' } })
}))

router.post('/refresh', asyncHandler(async (request, response) => {
    const rawToken = request.cookies?.edusphere_refresh
    if (!rawToken) throw new HttpError(401, 'Refresh session not found')
    const result = await pool.query('UPDATE refresh_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now() RETURNING user_id', [hashToken(rawToken)])
    const session = result.rows[0]
    if (!session) throw new HttpError(401, 'Refresh session expired')
    const userResult = await pool.query('SELECT role FROM users WHERE id = $1', [session.user_id])
    const user = userResult.rows[0]
    if (!user) throw new HttpError(401, 'Refresh session expired')
    const nextToken = await issueRefreshToken(session.user_id)
    response.cookie('edusphere_refresh', nextToken, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: env.COOKIE_SAME_SITE, maxAge: 30 * 24 * 60 * 60 * 1000 })
    response.json({ accessToken: signAccessToken(session.user_id, user.role) })
}))

router.post('/logout', asyncHandler(async (request, response) => { const token = request.cookies?.edusphere_refresh; if (token) await pool.query('UPDATE refresh_sessions SET revoked_at = now() WHERE token_hash = $1', [hashToken(token)]); response.clearCookie('edusphere_refresh', { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: env.COOKIE_SAME_SITE }); response.status(204).send() }))

router.post('/verify-email', asyncHandler(async (request, response) => { const token = z.string().min(32).parse(request.body.token); const result = await pool.query("UPDATE auth_tokens SET consumed_at = now() WHERE token_hash = $1 AND purpose = 'email-verification' AND consumed_at IS NULL AND expires_at > now() RETURNING user_id", [hashToken(token)]); if (!result.rowCount) throw new HttpError(400, 'Invalid or expired verification token'); await pool.query('UPDATE users SET email_verified_at = coalesce(email_verified_at, now()), status = \'active\' WHERE id = $1', [result.rows[0].user_id]); response.json({ message: 'Email verified' }) }))

router.post('/forgot-password', authRateLimit, asyncHandler(async (request, response) => {
    const input = passwordResetRequestSchema.parse(request.body)
    const result = await pool.query('SELECT id FROM users WHERE email = $1 AND lower(trim(full_name)) = lower(trim($2))', [input.email, input.fullName])
    if (result.rows[0]) {
        const code = createVerificationCode()
        await pool.query("UPDATE auth_tokens SET consumed_at = now() WHERE user_id = $1 AND purpose = 'password-reset-code' AND consumed_at IS NULL", [result.rows[0].id])
        await pool.query("INSERT INTO auth_tokens (user_id, token_hash, purpose, expires_at) VALUES ($1, $2, 'password-reset-code', now() + interval '10 minutes')", [result.rows[0].id, hashToken(code)])
        await sendPasswordResetCode(input.email, code)
    }
    response.json({ message: 'If the email and name match an account, a verification code has been sent.' })
}))
router.post('/verify-password-code', authRateLimit, asyncHandler(async (request, response) => {
    const input = passwordCodeSchema.parse(request.body)
    const result = await pool.query("UPDATE auth_tokens SET consumed_at = now() WHERE token_hash = $1 AND purpose = 'password-reset-code' AND consumed_at IS NULL AND expires_at > now() AND user_id = (SELECT id FROM users WHERE email = $2 AND lower(trim(full_name)) = lower(trim($3))) RETURNING user_id", [hashToken(input.code), input.email, input.fullName])
    if (!result.rowCount) throw new HttpError(400, 'Invalid or expired verification code')
    const resetToken = crypto.randomBytes(32).toString('base64url')
    await pool.query("INSERT INTO auth_tokens (user_id, token_hash, purpose, expires_at) VALUES ($1, $2, 'password-reset', now() + interval '10 minutes')", [result.rows[0].user_id, hashToken(resetToken)])
    response.json({ resetToken })
}))
router.post('/reset-password', authRateLimit, asyncHandler(async (request, response) => { const input = z.object({ token: z.string().min(32), password: passwordSchema }).parse(request.body); const passwordHash = await bcrypt.hash(input.password, 12); const result = await pool.query("UPDATE auth_tokens SET consumed_at = now() WHERE token_hash = $1 AND purpose = 'password-reset' AND consumed_at IS NULL AND expires_at > now() RETURNING user_id", [hashToken(input.token)]); if (!result.rowCount) throw new HttpError(400, 'Invalid or expired reset token'); await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, result.rows[0].user_id]); await pool.query('UPDATE refresh_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [result.rows[0].user_id]); response.json({ message: 'Password reset successfully' }) }))

export default router
