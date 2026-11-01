BEGIN;

ALTER TABLE library_courses
    ADD COLUMN IF NOT EXISTS school_id BIGINT REFERENCES admin_schools(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS teacher_subject_assignments (
    id BIGSERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    school_id BIGINT NOT NULL REFERENCES admin_schools(id) ON DELETE CASCADE,
    grade_id BIGINT NOT NULL REFERENCES grades(id) ON DELETE RESTRICT,
    program_id BIGINT REFERENCES programs(id) ON DELETE RESTRICT,
    subject_id BIGINT NOT NULL REFERENCES library_subjects(id) ON DELETE CASCADE,
    assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (teacher_id, school_id, grade_id, program_id, subject_id)
);

CREATE INDEX IF NOT EXISTS teacher_subject_assignments_scope_idx
    ON teacher_subject_assignments (teacher_id, school_id, grade_id, program_id, subject_id);

CREATE INDEX IF NOT EXISTS library_courses_school_scope_idx
    ON library_courses (school_id, education_level_id, grade_id, program_id, subject_id, status);

COMMIT;
