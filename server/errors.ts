export class HttpError extends Error {
    constructor(public statusCode: number, message: string, public details?: unknown) {
        super(message)
        this.name = 'HttpError'
    }
}

export function asyncHandler(handler: (request: import('express').Request, response: import('express').Response, next: import('express').NextFunction) => Promise<unknown>) {
    return (request: import('express').Request, response: import('express').Response, next: import('express').NextFunction) => {
        Promise.resolve(handler(request, response, next)).catch(next)
    }
}
