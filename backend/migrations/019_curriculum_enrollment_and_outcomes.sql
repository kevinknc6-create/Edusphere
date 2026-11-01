BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS school_id BIGINT REFERENCES admin_schools(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS subject_combination_id BIGINT REFERENCES curriculum_combinations(id) ON DELETE SET NULL;

ALTER TABLE curriculum_sources
    ADD COLUMN IF NOT EXISTS published_on DATE,
    ADD COLUMN IF NOT EXISTS checked_on DATE,
    ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20) NOT NULL DEFAULT 'unverified'
        CHECK (verification_status IN ('unverified', 'in_review', 'verified')),
    ADD COLUMN IF NOT EXISTS verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE programs
    ADD COLUMN IF NOT EXISTS curriculum_verification_status VARCHAR(20) NOT NULL DEFAULT 'unverified'
        CHECK (curriculum_verification_status IN ('unverified', 'in_review', 'verified')),
    ADD COLUMN IF NOT EXISTS curriculum_source_reference TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS curriculum_units (
    id BIGSERIAL PRIMARY KEY,
    curriculum_subject_id BIGINT NOT NULL REFERENCES curriculum_subjects(id) ON DELETE CASCADE,
    code VARCHAR(100) NOT NULL DEFAULT '',
    title VARCHAR(240) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    source_reference TEXT NOT NULL DEFAULT '',
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
    UNIQUE (curriculum_subject_id, code)
);

CREATE TABLE IF NOT EXISTS curriculum_learning_outcomes (
    id BIGSERIAL PRIMARY KEY,
    unit_id BIGINT NOT NULL REFERENCES curriculum_units(id) ON DELETE CASCADE,
    code VARCHAR(100) NOT NULL DEFAULT '',
    description TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    source_reference TEXT NOT NULL DEFAULT '',
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
    UNIQUE (unit_id, code)
);

CREATE TABLE IF NOT EXISTS tvet_learning_outcomes (
    id BIGSERIAL PRIMARY KEY,
    unit_id BIGINT NOT NULL REFERENCES tvet_units(id) ON DELETE CASCADE,
    code VARCHAR(100) NOT NULL DEFAULT '',
    description TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    source_reference TEXT NOT NULL DEFAULT '',
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
    UNIQUE (unit_id, code)
);

CREATE TABLE IF NOT EXISTS curriculum_materials (
    id BIGSERIAL PRIMARY KEY,
    curriculum_version_id BIGINT REFERENCES curriculum_versions(id) ON DELETE SET NULL,
    education_level_id BIGINT NOT NULL REFERENCES education_levels(id) ON DELETE RESTRICT,
    grade_id BIGINT REFERENCES grades(id) ON DELETE RESTRICT,
    program_id BIGINT REFERENCES programs(id) ON DELETE RESTRICT,
    subject_id BIGINT REFERENCES curriculum_subjects(id) ON DELETE CASCADE,
    material_type VARCHAR(30) NOT NULL CHECK (material_type IN ('textbook', 'teacher_guide', 'worksheet', 'digital', 'other')),
    title VARCHAR(240) NOT NULL,
    publisher VARCHAR(200) NOT NULL DEFAULT '',
    edition VARCHAR(120) NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    source_reference TEXT NOT NULL DEFAULT '',
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS school_textbook_assignments (
    school_id BIGINT NOT NULL REFERENCES admin_schools(id) ON DELETE CASCADE,
    material_id BIGINT NOT NULL REFERENCES curriculum_materials(id) ON DELETE CASCADE,
    assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (school_id, material_id)
);

CREATE TABLE IF NOT EXISTS student_curriculum_enrollments (
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    curriculum_subject_id BIGINT NOT NULL REFERENCES curriculum_subjects(id) ON DELETE CASCADE,
    enrolled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (student_id, curriculum_subject_id)
);

CREATE INDEX IF NOT EXISTS curriculum_units_subject_idx
    ON curriculum_units(curriculum_subject_id, status, position);
CREATE INDEX IF NOT EXISTS curriculum_outcomes_unit_idx
    ON curriculum_learning_outcomes(unit_id, status, position);
CREATE INDEX IF NOT EXISTS tvet_outcomes_unit_idx
    ON tvet_learning_outcomes(unit_id, status, position);
CREATE INDEX IF NOT EXISTS curriculum_materials_profile_idx
    ON curriculum_materials(education_level_id, grade_id, program_id, status);
CREATE INDEX IF NOT EXISTS student_curriculum_enrollments_status_idx
    ON student_curriculum_enrollments(student_id, status);

COMMIT;
