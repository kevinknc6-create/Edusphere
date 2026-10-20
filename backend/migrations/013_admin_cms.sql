BEGIN;

ALTER TABLE course_modules
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'published';
ALTER TABLE course_lessons
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'published';
ALTER TABLE lesson_notes
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'published';
ALTER TABLE lesson_examples
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'published';
ALTER TABLE lesson_exercises
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'published';

ALTER TABLE library_quizzes
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'draft';
UPDATE library_quizzes SET status = 'published' WHERE published = true AND status = 'draft';

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS teacher_verification_status VARCHAR(30) NOT NULL DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS teacher_permissions (
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission VARCHAR(80) NOT NULL,
    granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (teacher_id, permission)
);

CREATE TABLE IF NOT EXISTS library_assessments (
    id BIGSERIAL PRIMARY KEY,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('homework', 'test', 'exam')),
    course_id BIGINT NOT NULL REFERENCES library_courses(id) ON DELETE CASCADE,
    title VARCHAR(240) NOT NULL,
    instructions TEXT NOT NULL DEFAULT '',
    due_at TIMESTAMPTZ,
    total_marks INTEGER NOT NULL DEFAULT 100 CHECK (total_marks > 0),
    time_limit_seconds INTEGER CHECK (time_limit_seconds > 0),
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'published', 'rejected', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(120) NOT NULL,
    entity_type VARCHAR(60) NOT NULL,
    entity_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS library_assessments_course_status_idx
    ON library_assessments(course_id, kind, status);
CREATE INDEX IF NOT EXISTS admin_audit_logs_created_idx
    ON admin_audit_logs(created_at DESC);

COMMIT;