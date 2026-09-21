import 'dotenv/config'
import pg from 'pg'

const { Pool } = pg

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
})

pool.on('error', (error) => {
    console.error('Unexpected PostgreSQL pool error', error)
})
