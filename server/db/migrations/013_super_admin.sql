BEGIN;

INSERT INTO users (email, password_hash, full_name, role, status, email_verified_at)
VALUES (
    'kevinknc6@gmail.com',
    '$2b$12$dYs68.CkOUdWhr/G3/87WerFrMFA50YlDAxkQtNZshfB1VpYFFSBy',
    'Kevin',
    'super-admin',
    'active',
    now()
)
ON CONFLICT (email) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    full_name = EXCLUDED.full_name,
    role = 'super-admin',
    status = 'active',
    email_verified_at = COALESCE(users.email_verified_at, now());

INSERT INTO admins (user_id)
SELECT id FROM users WHERE email = 'kevinknc6@gmail.com'
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
