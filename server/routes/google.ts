import { Router } from 'express'
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { pool } from '../db/pool.js'
import { env } from '../config.js'
import { HttpError, asyncHandler } from '../errors.js'
import { signAccessToken } from '../middleware/auth.js'
import type { AppRole } from '../authorization.js'

const router = Router()
const STATE_COOKIE = 'edusphere_google_state'
const COMPLETION_COOKIE = 'edusphere_google_completion'
const OAUTH_TTL_SECONDS = 10 * 60
const COMPLETION_TTL_SECONDS = 60
const redirectUri = env.GOOGLE_REDIRECT_URI
    || new URL('/api/auth/google/callback', env.CLIENT_ORIGIN.split(',')[0].trim()).toString()
const oauth = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri)
    : null

type OAuthState = { state: string; nonce: string; codeVerifier: string; type: 'google-oauth-state' }
type CompletionClaims = { sub: string; type: 'google-oauth-completion' }

function cookieOptions(path: string, maxAge: number, sameSite: 'lax' | 'strict' | 'none' = 'lax') {
    return {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite,
        path,
        maxAge: maxAge * 1000,
    }
}

function redirectFailure(response: import('express').Response, code: string) {
    response.redirect(303, `${env.CLIENT_ORIGIN.split(',')[0].trim()}/?auth_error=${encodeURIComponent(code)}#signin`)
}

function isEqual(left: string | undefined, right: string) {
    if (!left) return false
    const a = Buffer.from(left)
    const b = Buffer.from(right)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
}

router.get('/start', (_request, response) => {
    if (!oauth || !env.GOOGLE_CLIENT_ID) {
        redirectFailure(response, 'google_not_configured')
        return
    }
    const state = crypto.randomBytes(32).toString('base64url')
    const nonce = crypto.randomBytes(32).toString('base64url')
    const codeVerifier = crypto.randomBytes(32).toString('base64url')
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
    const signedState = jwt.sign(
        { state, nonce, codeVerifier, type: 'google-oauth-state' } satisfies OAuthState,
        env.JWT_REFRESH_SECRET,
        { expiresIn: OAUTH_TTL_SECONDS, issuer: 'edusphere-api' },
    )
    response.cookie(STATE_COOKIE, signedState, cookieOptions('/api/auth/google/callback', OAUTH_TTL_SECONDS))
    response.setHeader('Cache-Control', 'no-store')
    response.redirect(303, oauth.generateAuthUrl({
        scope: ['openid', 'email', 'profile'],
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
        prompt: 'select_account',
    }))
})

router.get('/callback', asyncHandler(async (request, response) => {
    response.clearCookie(STATE_COOKIE, cookieOptions('/api/auth/google/callback', 0))
    if (!oauth || !env.GOOGLE_CLIENT_ID) {
        redirectFailure(response, 'google_not_configured')
        return
    }
    if (request.query.error) {
        redirectFailure(response, request.query.error === 'access_denied' ? 'google_cancelled' : 'google_failed')
        return
    }

    let state: OAuthState
    try {
        const claims = jwt.verify(String(request.cookies?.[STATE_COOKIE] || ''), env.JWT_REFRESH_SECRET, { issuer: 'edusphere-api' }) as OAuthState
        if (claims.type !== 'google-oauth-state' || !isEqual(request.query.state as string, claims.state)) throw new Error('Invalid OAuth state')
        state = claims
    } catch {
        redirectFailure(response, 'google_state')
        return
    }
    if (typeof request.query.code !== 'string') {
        redirectFailure(response, 'google_failed')
        return
    }

    let payload
    try {
        const { tokens } = await oauth.getToken({ code: request.query.code, codeVerifier: state.codeVerifier })
        if (!tokens.id_token) throw new Error('Google did not return an ID token')
        const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID })
        payload = ticket.getPayload()
    } catch (error) {
        console.error('[google] OAuth verification failed:', error instanceof Error ? error.message : 'unknown error')
        redirectFailure(response, 'google_failed')
        return
    }

    if (!payload || !payload.sub || !isEqual(payload.nonce, state.nonce)
        || !['https://accounts.google.com', 'accounts.google.com'].includes(payload.iss || '')) {
        redirectFailure(response, 'google_failed')
        return
    }
    if (payload.email_verified !== true || !payload.email) {
        redirectFailure(response, 'google_email_unverified')
        return
    }

    const email = payload.email.trim().toLowerCase()
    const name = (payload.name || email.split('@')[0]).replace(/\p{Cc}/gu, '').trim().slice(0, 120) || 'EduSphere learner'
    const client = await pool.connect()
    let user: { id: string; role: AppRole; status: string } | undefined
    try {
        await client.query('BEGIN')
        const identityResult = await client.query(
            `SELECT u.id, u.role, u.status
               FROM auth_identities i JOIN users u ON u.id = i.user_id
              WHERE i.provider = 'google' AND i.provider_user_id = $1
              FOR UPDATE OF u`,
            [payload.sub],
        )
        user = identityResult.rows[0]

        if (user) {
            await client.query(
                "UPDATE auth_identities SET email = $1, last_login_at = now() WHERE provider = 'google' AND provider_user_id = $2",
                [email, payload.sub],
            )
        } else {
            const emailResult = await client.query(
                'SELECT id, role, status FROM users WHERE lower(email) = $1 FOR UPDATE',
                [email],
            )
            user = emailResult.rows[0]
            if (user) {
                await client.query(
                    `INSERT INTO auth_identities (user_id, provider, provider_user_id, email)
                     VALUES ($1, 'google', $2, $3)`,
                    [user.id, payload.sub, email],
                )
                await client.query(
                    'UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1',
                    [user.id],
                )
            } else {
                const randomPassword = crypto.randomBytes(48).toString('base64url')
                const passwordHash = await bcrypt.hash(randomPassword, 12)
                const created = await client.query(
                    `INSERT INTO users (email, password_hash, full_name, role, status, email_verified_at)
                     VALUES ($1, $2, $3, 'student', 'active', now())
                     RETURNING id, role, status`,
                    [email, passwordHash, name],
                )
                const createdUser = created.rows[0]
                user = createdUser
                await client.query('INSERT INTO students (user_id) VALUES ($1)', [createdUser.id])
                await client.query(
                    `INSERT INTO auth_identities (user_id, provider, provider_user_id, email)
                     VALUES ($1, 'google', $2, $3)`,
                    [createdUser.id, payload.sub, email],
                )
            }
        }
        await client.query('COMMIT')
    } catch (error) {
        await client.query('ROLLBACK')
        if ((error as { code?: string }).code === '23505') {
            redirectFailure(response, 'google_email_exists')
            return
        }
        throw error
    } finally {
        client.release()
    }

    if (!user || user.status === 'suspended') {
        redirectFailure(response, 'google_failed')
        return
    }
    const authenticatedUser = user
    const completion = jwt.sign(
        { sub: authenticatedUser.id, type: 'google-oauth-completion' } satisfies CompletionClaims,
        env.JWT_REFRESH_SECRET,
        { expiresIn: COMPLETION_TTL_SECONDS, issuer: 'edusphere-api' },
    )
    response.cookie(COMPLETION_COOKIE, completion, cookieOptions('/api/auth/google/complete', COMPLETION_TTL_SECONDS, env.COOKIE_SAME_SITE))
    response.redirect(303, env.CLIENT_ORIGIN.split(',')[0].trim() + '/?google_auth=complete')
}))

router.post('/complete', asyncHandler(async (request, response) => {
    const allowedOrigins = env.CLIENT_ORIGIN.split(',').map((origin) => origin.trim())
    if (request.get('origin') && !allowedOrigins.includes(request.get('origin')!)) {
        throw new HttpError(403, 'Google sign-in completion was requested from an untrusted origin')
    }
    response.clearCookie(COMPLETION_COOKIE, cookieOptions('/api/auth/google/complete', 0, env.COOKIE_SAME_SITE))
    let claims: CompletionClaims
    try {
        claims = jwt.verify(String(request.cookies?.[COMPLETION_COOKIE] || ''), env.JWT_REFRESH_SECRET, { issuer: 'edusphere-api' }) as CompletionClaims
        if (claims.type !== 'google-oauth-completion') throw new Error('Invalid completion token')
    } catch {
        throw new HttpError(401, 'Google sign-in could not be completed. Please try again.')
    }

    const result = await pool.query(
        'SELECT id, email, full_name, role, status FROM users WHERE id = $1',
        [claims.sub],
    )
    const user = result.rows[0]
    if (!user || user.status !== 'active') throw new HttpError(403, 'This account is not active')
    const authenticatedUser = user

    const refreshToken = crypto.randomBytes(48).toString('base64url')
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')
    await pool.query(
        "INSERT INTO refresh_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '30 days')",
        [authenticatedUser.id, tokenHash],
    )
    response.cookie('edusphere_refresh', refreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: env.COOKIE_SAME_SITE,
        maxAge: 30 * 24 * 60 * 60 * 1000,
    })
    response.json({
        accessToken: signAccessToken(authenticatedUser.id, authenticatedUser.role),
        user: { id: authenticatedUser.id, email: authenticatedUser.email, fullName: authenticatedUser.full_name, role: authenticatedUser.role },
    })
}))

export default router
