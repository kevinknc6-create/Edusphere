-- Additive Admin CMS schema. Existing content and relationships remain intact.
ALTER TYPE content_status ADD VALUE IF NOT EXISTS 'archived';

ALTER TABLE modules ADD COLUMN IF NOT EXISTS status content_status NOT NULL DEFAULT 'draft';
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS status content_status NOT NULL DEFAULT 'draft';
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS status content_status NOT NULL DEFAULT 'draft';
ALTER TABLE tests ADD COLUMN IF NOT EXISTS status content_status NOT NULL DEFAULT 'draft';
ALTER TABLE exams ADD COLUMN IF NOT EXISTS status content_status NOT NULL DEFAULT 'draft';
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS status content_status NOT NULL DEFAULT 'draft';
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

UPDATE quizzes SET status = CASE WHEN published THEN 'published'::content_status ELSE 'draft'::content_status END;
UPDATE tests SET status = CASE WHEN published THEN 'published'::content_status ELSE 'draft'::content_status END;
UPDATE exams SET status = CASE WHEN published THEN 'published'::content_status ELSE 'draft'::content_status END;

CREATE TABLE IF NOT EXISTS lesson_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    status content_status NOT NULL DEFAULT 'draft',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lesson_examples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    status content_status NOT NULL DEFAULT 'draft',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lesson_exercises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    answer TEXT NOT NULL DEFAULT '',
    status content_status NOT NULL DEFAULT 'draft',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teacher_permissions (
    teacher_id UUID NOT NULL REFERENCES teachers(user_id) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    granted_by UUID REFERENCES admins(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (teacher_id, permission)
);

CREATE INDEX IF NOT EXISTS modules_status_idx ON modules(course_id, status, position);
CREATE INDEX IF NOT EXISTS lessons_status_idx ON lessons(module_id, status, position);
CREATE INDEX IF NOT EXISTS lesson_notes_status_idx ON lesson_notes(lesson_id, status);
CREATE INDEX IF NOT EXISTS lesson_examples_status_idx ON lesson_examples(lesson_id, status);
CREATE INDEX IF NOT EXISTS lesson_exercises_status_idx ON lesson_exercises(lesson_id, status);
CREATE INDEX IF NOT EXISTS assignments_status_idx ON assignments(course_id, status, due_at);