BEGIN;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

INSERT INTO public.users (name, email, password_hash, role, status, email_verified_at)
VALUES (
    'Kevin',
    'kevinknc6@gmail.com',
    '$2b$12$dYs68.CkOUdWhr/G3/87WerFrMFA50YlDAxkQtNZshfB1VpYFFSBy',
    'admin',
    'active',
    now()
)
ON CONFLICT (email) DO UPDATE SET
    name = EXCLUDED.name,
    password_hash = EXCLUDED.password_hash,
    role = 'admin',
    status = 'active',
    email_verified_at = COALESCE(public.users.email_verified_at, now());

COMMIT;