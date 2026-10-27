CREATE TABLE IF NOT EXISTS auth_identities (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider = 'google'),
    provider_user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT auth_identities_provider_user_unique UNIQUE (provider, provider_user_id),
    CONSTRAINT auth_identities_user_provider_unique UNIQUE (user_id, provider)
);
