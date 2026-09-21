-- Additive learner progress and assessment attempts for dedicated TVET/University content.
CREATE TABLE IF NOT EXISTS tvet_lesson_progress (
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id BIGINT NOT NULL REFERENCES tvet_lessons(id) ON DELETE CASCADE,
    completed_at TIMESTAMPTZ,
    seconds_spent INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(student_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS tvet_assessment_attempts (
    id BIGSERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assessment_id BIGINT NOT NULL REFERENCES tvet_assessments(id) ON DELETE CASCADE,
    answers JSONB NOT NULL DEFAULT '{}'::jsonb,
    score NUMERIC(5,2) NOT NULL DEFAULT 0,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS university_lesson_progress (
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id BIGINT NOT NULL REFERENCES library_courses(id) ON DELETE CASCADE,
    lesson_id BIGINT NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
    completed_at TIMESTAMPTZ,
    seconds_spent INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(student_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS university_assessment_attempts (
    id BIGSERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quiz_id BIGINT REFERENCES library_quizzes(id) ON DELETE CASCADE,
    answers JSONB NOT NULL DEFAULT '{}'::jsonb,
    score NUMERIC(5,2) NOT NULL DEFAULT 0,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);