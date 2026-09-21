const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool(process.env.DB_HOST || process.env.DB_NAME || process.env.DB_USER
  ? {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  }
  : { connectionString: process.env.DATABASE_URL });

module.exports = pool;