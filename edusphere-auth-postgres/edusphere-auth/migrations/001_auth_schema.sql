-- 001_auth_schema.sql
-- Safe, additive migration. It never drops, truncates or rewrites existing data.
--  * If a `users` table already exists, only the missing columns are ADDED to it.
--  * New tables are created with IF NOT EXISTS and use the same id type as users.id.
-- Review the "EXISTING PROJECT" notes in README.md before running against production.

-- ---------------------------------------------------------------- users
create table if not exists users (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,
  name              text not null,
  password_hash     text,                       -- NULL for accounts that only use Google
  email_verified_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint users_email_len check (char_length(email) <= 254),
  constraint users_password_is_argon2id check (password_hash is null or password_hash like '$argon2id$%')
);

-- Existing table? Add whatever is missing (all nullable, so no rewrite and no data loss).
alter table users add column if not exists name              text;
alter table users add column if not exists password_hash     text;
alter table users add column if not exists email_verified_at timestamptz;
alter table users add column if not exists created_at        timestamptz default now();
alter table users add column if not exists updated_at        timestamptz default now();

-- Case-insensitive uniqueness: "Ada@x.com" and "ada@x.com" are the same account.
create unique index if not exists users_email_lower_key on users (lower(email));

-- ---------------------------------------------------------------- identities / tokens
-- Foreign keys follow the actual type of users.id, so this also works when it is an integer.
do $$
declare idtype text;
begin
  select format_type(a.atttypid, a.atttypmod) into idtype
    from pg_attribute a
   where a.attrelid = 'users'::regclass and a.attname = 'id' and not a.attisdropped;

  execute format($t$
    create table if not exists auth_identities (
      id               bigint generated always as identity primary key,
      user_id          %s not null references users(id) on delete cascade,
      provider         text not null check (provider in ('google')),
      provider_user_id text not null,                 -- Google "sub" claim (stable, never reused)
      email            text,                          -- informational snapshot, never used for matching
      created_at       timestamptz not null default now(),
      last_login_at    timestamptz,
      constraint auth_identities_provider_sub_key unique (provider, provider_user_id),
      constraint auth_identities_user_provider_key unique (user_id, provider)
    )$t$, idtype);

  execute format($t$
    create table if not exists email_tokens (
      id         bigint generated always as identity primary key,
      user_id    %s not null references users(id) on delete cascade,
      purpose    text not null check (purpose in ('verify_email', 'reset_password')),
      token_hash text not null unique,                -- SHA-256 of the emailed token; the raw token is never stored
      expires_at timestamptz not null,
      used_at    timestamptz,
      created_at timestamptz not null default now()
    )$t$, idtype);
end $$;

create index if not exists auth_identities_user_idx on auth_identities (user_id);
create index if not exists email_tokens_user_purpose_idx on email_tokens (user_id, purpose);
create index if not exists email_tokens_expires_idx on email_tokens (expires_at);

-- ---------------------------------------------------------------- sessions (connect-pg-simple)
create table if not exists session (
  sid    varchar not null primary key,
  sess   json    not null,
  expire timestamp(6) not null
);
create index if not exists session_expire_idx on session (expire);
