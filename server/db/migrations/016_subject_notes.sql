ALTER TABLE students
    ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES admin_schools(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS students_school_profile_idx
    ON students(school_id, education_level_id, grade_id, program_id);

CREATE TABLE IF NOT EXISTS subject_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES admin_schools(id) ON DELETE RESTRICT,
    education_level_id UUID NOT NULL REFERENCES education_levels(id) ON DELETE RESTRICT,
    grade_id UUID NOT NULL REFERENCES grades(id) ON DELETE RESTRICT,
    program_id UUID REFERENCES programs(id) ON DELETE RESTRICT,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    topic TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    status content_status NOT NULL DEFAULT 'draft',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (length(trim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS subject_notes_scope_status_idx
    ON subject_notes(school_id, education_level_id, grade_id, program_id, subject_id, status);
