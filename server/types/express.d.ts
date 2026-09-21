import type { AppRole } from '../authorization.js'

declare global {
    namespace Express {
        interface Request {
            auth?: { userId: string; role: AppRole }
        }
    }
}

export { }
