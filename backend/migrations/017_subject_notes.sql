BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS school_id BIGINT REFERENCES admin_schools(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_school_profile_idx
    ON users(school_id, education_level_id, grade_id, program_id);

CREATE TABLE IF NOT EXISTS subject_notes (
    id BIGSERIAL PRIMARY KEY,
    school_id BIGINT NOT NULL REFERENCES admin_schools(id) ON DELETE RESTRICT,
    education_level_id BIGINT NOT NULL REFERENCES education_levels(id) ON DELETE RESTRICT,
    grade_id BIGINT NOT NULL REFERENCES grades(id) ON DELETE RESTRICT,
    program_id BIGINT REFERENCES programs(id) ON DELETE RESTRICT,
    subject_id BIGINT NOT NULL REFERENCES library_subjects(id) ON DELETE RESTRICT,
    title VARCHAR(240) NOT NULL,
    topic VARCHAR(240) NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'archived')),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (length(trim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS subject_notes_scope_status_idx
    ON subject_notes(school_id, education_level_id, grade_id, program_id, subject_id, status);

COMMIT;
