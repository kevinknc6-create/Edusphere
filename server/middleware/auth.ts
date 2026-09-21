import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config.js'
import { HttpError } from '../errors.js'
import { authorize, type AppRole, type Permission } from '../authorization.js'

type AccessClaims = { sub: string; role: AppRole; type: 'access' }

export function signAccessToken(userId: string, role: AppRole) {
    return jwt.sign({ sub: userId, role, type: 'access' } satisfies AccessClaims, env.JWT_ACCESS_SECRET, { expiresIn: '15m', issuer: 'edusphere-api' })
}

export function requireAuth(request: Request, _response: Response, next: NextFunction) {
    const token = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : undefined
    if (!token) return next(new HttpError(401, 'Authentication required'))
    try {
        const claims = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'edusphere-api' }) as AccessClaims
        if (claims.type !== 'access') throw new Error('Invalid token type')
        request.auth = { userId: claims.sub, role: claims.role }
        return next()
    } catch {
        return next(new HttpError(401, 'Invalid or expired access token'))
    }
}

export function requirePermission(permission: Permission) {
    return (request: Request, _response: Response, next: NextFunction) => {
        if (!request.auth) return next(new HttpError(403, 'Insufficient permissions'))
        try { authorize(request.auth.role, permission) } catch { return next(new HttpError(403, 'Insufficient permissions')) }
        return next()
    }
}
