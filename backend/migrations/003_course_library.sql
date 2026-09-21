-- Additive Edusphere course library migration.
-- The existing users table is preserved and referenced by its integer id.

CREATE TABLE IF NOT EXISTS education_levels (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    category VARCHAR(40) NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS grades (
    id BIGSERIAL PRIMARY KEY,
    education_level_id BIGINT NOT NULL REFERENCES education_levels(id) ON DELETE CASCADE,
    code VARCHAR(40) NOT NULL,
    name VARCHAR(120) NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    UNIQUE(education_level_id, code)
);

CREATE TABLE IF NOT EXISTS faculties (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(160) NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS departments (
    id BIGSERIAL PRIMARY KEY,
    faculty_id BIGINT NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    UNIQUE(faculty_id, name)
);

CREATE TABLE IF NOT EXISTS programs (
    id BIGSERIAL PRIMARY KEY,
    department_id BIGINT REFERENCES departments(id) ON DELETE SET NULL,
    name VARCHAR(160) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    UNIQUE(department_id, name)
);

CREATE TABLE IF NOT EXISTS library_subjects (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    education_level_id BIGINT REFERENCES education_levels(id) ON DELETE SET NULL,
    grade_id BIGINT REFERENCES grades(id) ON DELETE SET NULL,
    program_id BIGINT REFERENCES programs(id) ON DELETE SET NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(name, education_level_id, grade_id, program_id)
);

CREATE TABLE IF NOT EXISTS library_courses (
    id BIGSERIAL PRIMARY KEY,
    subject_id BIGINT NOT NULL REFERENCES library_subjects(id) ON DELETE RESTRICT,
    program_id BIGINT REFERENCES programs(id) ON DELETE SET NULL,
    education_level_id BIGINT REFERENCES education_levels(id) ON DELETE SET NULL,
    grade_id BIGINT REFERENCES grades(id) ON DELETE SET NULL,
    teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(240) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    difficulty VARCHAR(40) NOT NULL DEFAULT 'Beginner',
    learning_objectives JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'published', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS course_modules (
    id BIGSERIAL PRIMARY KEY,
    course_id BIGINT NOT NULL REFERENCES library_courses(id) ON DELETE CASCADE,
    title VARCHAR(240) NOT NULL,
    position INTEGER NOT NULL,
    UNIQUE(course_id, position)
);

CREATE TABLE IF NOT EXISTS course_lessons (
    id BIGSERIAL PRIMARY KEY,
    module_id BIGINT NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
    title VARCHAR(240) NOT NULL,
    explanation TEXT NOT NULL DEFAULT '',
    key_points JSONB NOT NULL DEFAULT '[]'::jsonb,
    definitions JSONB NOT NULL DEFAULT '[]'::jsonb,
    summary TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL,
    language VARCHAR(40) NOT NULL DEFAULT 'English',
    UNIQUE(module_id, position)
);

CREATE TABLE IF NOT EXISTS lesson_notes (
    id BIGSERIAL PRIMARY KEY,
    lesson_id BIGINT NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
    title VARCHAR(240) NOT NULL DEFAULT 'Notes',
    body TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lesson_examples (
    id BIGSERIAL PRIMARY KEY,
    lesson_id BIGINT NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
    title VARCHAR(240) NOT NULL,
    body TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lesson_exercises (
    id BIGSERIAL PRIMARY KEY,
    lesson_id BIGINT NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    answer TEXT,
    position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS library_quizzes (
    id BIGSERIAL PRIMARY KEY,
    course_id BIGINT NOT NULL REFERENCES library_courses(id) ON DELETE CASCADE,
    lesson_id BIGINT REFERENCES course_lessons(id) ON DELETE CASCADE,
    title VARCHAR(240) NOT NULL,
    published BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS quiz_questions (
    id BIGSERIAL PRIMARY KEY,
    quiz_id BIGINT NOT NULL REFERENCES library_quizzes(id) ON DELETE CASCADE,
    question_type VARCHAR(40) NOT NULL DEFAULT 'multiple-choice',
    prompt TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    correct_answer TEXT,
    explanation TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS library_enrollments (
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id BIGINT NOT NULL REFERENCES library_courses(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(student_id, course_id)
);

CREATE TABLE IF NOT EXISTS lesson_progress (
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id BIGINT NOT NULL REFERENCES library_courses(id) ON DELETE CASCADE,
    lesson_id BIGINT NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
    completed_at TIMESTAMPTZ,
    seconds_spent INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(student_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS library_quiz_attempts (
    id BIGSERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quiz_id BIGINT NOT NULL REFERENCES library_quizzes(id) ON DELETE CASCADE,
    answers JSONB NOT NULL DEFAULT '{}'::jsonb,
    score NUMERIC(5,2) NOT NULL DEFAULT 0,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS library_bookmarks (
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id BIGINT NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(student_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS recently_viewed_lessons (
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id BIGINT NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
    viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(student_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS library_courses_taxonomy_idx ON library_courses(education_level_id, grade_id, program_id, status);
CREATE INDEX IF NOT EXISTS course_lessons_module_idx ON course_lessons(module_id, position);
CREATE INDEX IF NOT EXISTS lesson_progress_student_course_idx ON lesson_progress(student_id, course_id);
CREATE INDEX IF NOT EXISTS recently_viewed_student_idx ON recently_viewed_lessons(student_id, viewed_at DESC);

INSERT INTO education_levels (code, name, category, position) VALUES
    ('PRIMARY', 'Primary', 'PRIMARY', 1),
    ('LOWER_SECONDARY', 'Lower Secondary', 'SECONDARY', 2),
    ('UPPER_SECONDARY', 'Upper Secondary', 'SECONDARY', 3),
    ('TVET', 'TVET', 'TVET', 4),
    ('UNIVERSITY', 'University', 'UNIVERSITY', 5)
ON CONFLICT (code) DO NOTHING;

INSERT INTO grades (education_level_id, code, name, position)
SELECT level_id, 'PRIMARY_' || number, 'Primary ' || number, number
FROM (SELECT id AS level_id FROM education_levels WHERE code = 'PRIMARY') levels
CROSS JOIN generate_series(1, 6) number
ON CONFLICT (education_level_id, code) DO NOTHING;

INSERT INTO grades (education_level_id, code, name, position)
SELECT level_id, 'SECONDARY_' || number, 'Secondary ' || number, number
FROM (SELECT id AS level_id FROM education_levels WHERE code IN ('LOWER_SECONDARY', 'UPPER_SECONDARY')) levels
CROSS JOIN generate_series(1, 6) number
ON CONFLICT (education_level_id, code) DO NOTHING;

INSERT INTO grades (education_level_id, code, name, position)
SELECT id, 'L' || number, 'L' || number, number
FROM education_levels CROSS JOIN generate_series(3, 5) number
WHERE code = 'TVET'
ON CONFLICT (education_level_id, code) DO NOTHING;

INSERT INTO faculties (name) VALUES
    ('Computing and Information Technology'), ('Business and Economics'), ('Law'), ('Education'), ('Health Sciences'), ('Engineering'), ('Agriculture'), ('Humanities and Social Sciences')
ON CONFLICT (name) DO NOTHING;