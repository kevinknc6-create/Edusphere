import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    CLIENT_ORIGIN: z.string().min(1).default('http://localhost:5173'),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_REDIRECT_URI: z.string().url().optional(),
    COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('lax'),
    GEMINI_API_KEY: z.string().min(1).optional(),
    GEMINI_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
    RESEND_API_KEY: z.string().min(1).optional(),
    MAIL_FROM: z.string().email().default('EduSphere <onboarding@resend.dev>'),
})
export const env = envSchema.parse(process.env)
