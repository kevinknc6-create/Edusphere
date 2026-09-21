-- Additive teacher AI draft storage. Existing course content is never overwritten.
CREATE TABLE IF NOT EXISTS teacher_content_drafts (
    id BIGSERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id BIGINT REFERENCES library_courses(id) ON DELETE SET NULL,
    kind VARCHAR(60) NOT NULL,
    title VARCHAR(240) NOT NULL,
    content JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teacher_content_drafts_owner_idx ON teacher_content_drafts(teacher_id, updated_at DESC);