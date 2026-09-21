import type { ErrorRequestHandler, RequestHandler } from 'express'
import { HttpError } from '../errors.js'

export const notFound: RequestHandler = (_request, _response, next) => next(new HttpError(404, 'Route not found'))

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
    const databaseUnavailable = isDatabaseConnectionError(error)
    const errorStatus = (error as { statusCode?: unknown }).statusCode
    const statusCode = error instanceof HttpError ? error.statusCode : databaseUnavailable ? 503 : typeof errorStatus === 'number' && errorStatus >= 400 && errorStatus < 500 ? errorStatus : 500
    const message = error instanceof HttpError ? error.message : databaseUnavailable ? 'Database unavailable. Start PostgreSQL and try again.' : statusCode < 500 ? 'Invalid request.' : 'Internal server error'
    if (statusCode >= 500) console.error(error)
    response.status(statusCode).json({ error: { message, requestId: request.headers['x-request-id'] || null, details: error instanceof HttpError ? error.details : undefined } })
}

function isDatabaseConnectionError(error: unknown): boolean {
    if (!error) return false
    const candidate = error as { name?: string; code?: string; message?: string; errors?: unknown[] }
    const connectionCodes = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'])
    return candidate.name === 'AggregateError' || Boolean(candidate.code && connectionCodes.has(candidate.code)) || Boolean(candidate.message?.includes('ECONNREFUSED')) || Boolean(candidate.errors?.some((nestedError) => isDatabaseConnectionError(nestedError)))
}
