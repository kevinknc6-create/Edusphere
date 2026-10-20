BEGIN;

CREATE TABLE IF NOT EXISTS admin_schools (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    location VARCHAR(240) NOT NULL DEFAULT '',
    phone VARCHAR(40) NOT NULL DEFAULT '',
    email VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('active', 'inactive', 'pending')),
    created_by INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_schools_email_unique_idx ON admin_schools(lower(email));
CREATE INDEX IF NOT EXISTS admin_schools_created_idx ON admin_schools(created_at DESC);

CREATE TABLE IF NOT EXISTS admin_class_schedule (
    id BIGSERIAL PRIMARY KEY,
    course_id BIGINT NOT NULL,
    teacher_id INTEGER NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    room VARCHAR(160) NOT NULL DEFAULT '',
    created_by INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS admin_class_schedule_starts_idx ON admin_class_schedule(starts_at);

CREATE TABLE IF NOT EXISTS admin_conversations (
    id BIGSERIAL PRIMARY KEY,
    subject VARCHAR(160) NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL,
    recipient_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (created_by <> recipient_id)
);
CREATE INDEX IF NOT EXISTS admin_conversations_participants_idx ON admin_conversations(created_by, recipient_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS admin_messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES admin_conversations(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_messages_conversation_idx ON admin_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS admin_notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title VARCHAR(160) NOT NULL,
    body TEXT NOT NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_notifications_user_created_idx ON admin_notifications(user_id, created_at DESC);

COMMIT;
