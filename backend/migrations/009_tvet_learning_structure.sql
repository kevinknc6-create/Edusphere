-- Additive TVET learning hierarchy. Content remains unpublished until sourced and reviewed.
CREATE TABLE IF NOT EXISTS tvet_subjects (
    id BIGSERIAL PRIMARY KEY,
    program_id BIGINT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    grade_id BIGINT NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
    curriculum_version_id BIGINT REFERENCES curriculum_versions(id) ON DELETE SET NULL,
    code VARCHAR(100) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source_reference TEXT NOT NULL DEFAULT '',
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
    UNIQUE(program_id, grade_id, code)
);

CREATE TABLE IF NOT EXISTS tvet_competences (
    id BIGSERIAL PRIMARY KEY,
    subject_id BIGINT NOT NULL REFERENCES tvet_subjects(id) ON DELETE CASCADE,
    code VARCHAR(100) NOT NULL,
    title VARCHAR(240) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
    UNIQUE(subject_id, code)
);

CREATE TABLE IF NOT EXISTS tvet_modules (
    id BIGSERIAL PRIMARY KEY,
    competence_id BIGINT NOT NULL REFERENCES tvet_competences(id) ON DELETE CASCADE,
    title VARCHAR(240) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
    UNIQUE(competence_id, position)
);

CREATE TABLE IF NOT EXISTS tvet_units (
    id BIGSERIAL PRIMARY KEY,
    module_id BIGINT NOT NULL REFERENCES tvet_modules(id) ON DELETE CASCADE,
    title VARCHAR(240) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
    UNIQUE(module_id, position)
);

CREATE TABLE IF NOT EXISTS tvet_lessons (
    id BIGSERIAL PRIMARY KEY,
    unit_id BIGINT NOT NULL REFERENCES tvet_units(id) ON DELETE CASCADE,
    title VARCHAR(240) NOT NULL,
    content JSONB NOT NULL DEFAULT '{}'::jsonb,
    duration_minutes INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
    UNIQUE(unit_id, position)
);

CREATE TABLE IF NOT EXISTS tvet_notes (
    id BIGSERIAL PRIMARY KEY,
    lesson_id BIGINT NOT NULL REFERENCES tvet_lessons(id) ON DELETE CASCADE,
    title VARCHAR(240) NOT NULL DEFAULT 'Notes',
    body TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tvet_practical_exercises (
    id BIGSERIAL PRIMARY KEY,
    lesson_id BIGINT NOT NULL REFERENCES tvet_lessons(id) ON DELETE CASCADE,
    title VARCHAR(240) NOT NULL,
    instructions TEXT NOT NULL,
    resources JSONB NOT NULL DEFAULT '[]'::jsonb,
    position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tvet_assessments (
    id BIGSERIAL PRIMARY KEY,
    program_id BIGINT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    grade_id BIGINT NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
    lesson_id BIGINT REFERENCES tvet_lessons(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL CHECK (type IN ('quiz', 'test', 'exam', 'practical')),
    title VARCHAR(240) NOT NULL,
    instructions TEXT NOT NULL DEFAULT '',
    time_limit_seconds INTEGER,
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired'))
);

CREATE TABLE IF NOT EXISTS tvet_assessment_questions (
    id BIGSERIAL PRIMARY KEY,
    assessment_id BIGINT NOT NULL REFERENCES tvet_assessments(id) ON DELETE CASCADE,
    type VARCHAR(40) NOT NULL DEFAULT 'multiple-choice',
    prompt TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    correct_answer TEXT,
    marks INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0,
    UNIQUE(assessment_id, position)
);

CREATE INDEX IF NOT EXISTS tvet_subjects_program_grade_idx ON tvet_subjects(program_id, grade_id, status);
CREATE INDEX IF NOT EXISTS tvet_competences_subject_idx ON tvet_competences(subject_id, status);
CREATE INDEX IF NOT EXISTS tvet_modules_competence_idx ON tvet_modules(competence_id, status);
CREATE INDEX IF NOT EXISTS tvet_units_module_idx ON tvet_units(module_id, status);
CREATE INDEX IF NOT EXISTS tvet_lessons_unit_idx ON tvet_lessons(unit_id, status);
CREATE INDEX IF NOT EXISTS tvet_assessments_profile_idx ON tvet_assessments(program_id, grade_id, type, status);