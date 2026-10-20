const bcrypt = require('bcryptjs');
const { Client } = require('pg');
const password = 'Admin!Edusphere2026';
const hash = bcrypt.hashSync(password, 12);
const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'edusphere_db',
    user: 'postgres',
    password: '0787827215',
});

client.connect()
    .then(() => client.query('UPDATE users SET password_hash = $1 WHERE email = $2', [hash, 'kevinknc6@gmail.com']))
    .then(() => console.log('UPDATED'))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => client.end());
