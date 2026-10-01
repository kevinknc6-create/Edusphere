CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('student', 'teacher', 'admin', 'super-admin');
CREATE TYPE account_status AS ENUM ('active', 'suspended', 'pending');
CREATE TYPE content_status AS ENUM ('draft', 'pending', 'approved', 'rejected', 'published');
CREATE TYPE question_type AS ENUM ('multiple-choice', 'true-false', 'fill-blank', 'matching', 'short-answer', 'programming');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'student',
    status account_status NOT NULL DEFAULT 'pending',
    email_verified_at TIMESTAMPTZ,
    profile_picture_url TEXT,
    country TEXT,
    preferred_language TEXT NOT NULL DEFAULT 'English',
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
    CONSTRAINT users_password_hash_present CHECK (length(password_hash) > 20)
);
CREATE INDEX users_role_status_idx ON users(role, status);

CREATE TABLE students (user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, education_level TEXT, school_class TEXT);
CREATE TABLE teachers (user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, bio TEXT, verification_status account_status NOT NULL DEFAULT 'pending');
CREATE TABLE admins (user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE);

CREATE TABLE subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', created_by UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE subject_teachers (subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE, teacher_id UUID REFERENCES teachers(user_id) ON DELETE CASCADE, PRIMARY KEY (subject_id, teacher_id));

CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT, teacher_id UUID NOT NULL REFERENCES teachers(user_id) ON DELETE RESTRICT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', difficulty TEXT NOT NULL DEFAULT 'Beginner', status content_status NOT NULL DEFAULT 'draft', approved_by UUID REFERENCES admins(user_id) ON DELETE SET NULL, published_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX courses_subject_status_idx ON courses(subject_id, status);
CREATE INDEX courses_teacher_idx ON courses(teacher_id);

CREATE TABLE modules (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE, title TEXT NOT NULL, position INTEGER NOT NULL, UNIQUE(course_id, position));
CREATE TABLE lessons (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE, title TEXT NOT NULL, content JSONB NOT NULL DEFAULT '{}'::jsonb, duration_minutes INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL, UNIQUE(module_id, position));
CREATE INDEX lessons_module_position_idx ON lessons(module_id, position);

CREATE TABLE enrollments (student_id UUID REFERENCES students(user_id) ON DELETE CASCADE, course_id UUID REFERENCES courses(id) ON DELETE CASCADE, enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(student_id, course_id));
CREATE TABLE progress (student_id UUID REFERENCES students(user_id) ON DELETE CASCADE, course_id UUID REFERENCES courses(id) ON DELETE CASCADE, lesson_id UUID REFERENCES lessons(id) ON DELETE CASCADE, completed_at TIMESTAMPTZ, seconds_spent INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(student_id, lesson_id));
CREATE INDEX progress_student_course_idx ON progress(student_id, course_id);

CREATE TABLE quizzes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE, lesson_id UUID REFERENCES lessons(id) ON DELETE CASCADE, title TEXT NOT NULL, time_limit_seconds INTEGER, published BOOLEAN NOT NULL DEFAULT false);
CREATE TABLE questions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE, type question_type NOT NULL, prompt TEXT NOT NULL, explanation TEXT NOT NULL DEFAULT '', marks INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL, UNIQUE(quiz_id, position));
CREATE TABLE answers (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE, answer_text TEXT NOT NULL, is_correct BOOLEAN NOT NULL DEFAULT false);
CREATE TABLE quiz_attempts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE, student_id UUID NOT NULL REFERENCES students(user_id) ON DELETE CASCADE, answers JSONB NOT NULL DEFAULT '{}'::jsonb, score NUMERIC(5,2) NOT NULL DEFAULT 0, submitted_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX quiz_attempts_student_idx ON quiz_attempts(student_id, submitted_at DESC);

CREATE TABLE assignments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE, teacher_id UUID NOT NULL REFERENCES teachers(user_id) ON DELETE RESTRICT, title TEXT NOT NULL, instructions TEXT NOT NULL, due_at TIMESTAMPTZ NOT NULL, total_marks INTEGER NOT NULL DEFAULT 100, resources JSONB NOT NULL DEFAULT '[]'::jsonb);
CREATE TABLE submissions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE, student_id UUID NOT NULL REFERENCES students(user_id) ON DELETE CASCADE, content JSONB NOT NULL DEFAULT '{}'::jsonb, score NUMERIC(5,2), feedback TEXT, submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(assignment_id, student_id));

CREATE TABLE exams (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE, title TEXT NOT NULL, time_limit_seconds INTEGER NOT NULL, published BOOLEAN NOT NULL DEFAULT false);
CREATE TABLE exam_attempts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE, student_id UUID NOT NULL REFERENCES students(user_id) ON DELETE CASCADE, answers JSONB NOT NULL DEFAULT '{}'::jsonb, score NUMERIC(5,2) NOT NULL DEFAULT 0, started_at TIMESTAMPTZ NOT NULL DEFAULT now(), submitted_at TIMESTAMPTZ);

CREATE TABLE certificates (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), student_id UUID NOT NULL REFERENCES students(user_id) ON DELETE CASCADE, course_id UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT, issued_at TIMESTAMPTZ NOT NULL DEFAULT now(), certificate_url TEXT, UNIQUE(student_id, course_id));
CREATE TABLE notifications (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT NOT NULL, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX notifications_user_created_idx ON notifications(user_id, created_at DESC);
CREATE TABLE bookmarks (student_id UUID REFERENCES students(user_id) ON DELETE CASCADE, lesson_id UUID REFERENCES lessons(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(student_id, lesson_id));
CREATE TABLE notes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), student_id UUID REFERENCES students(user_id) ON DELETE CASCADE, lesson_id UUID REFERENCES lessons(id) ON DELETE CASCADE, body TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(student_id, lesson_id));
CREATE TABLE achievements (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL);
CREATE TABLE student_achievements (student_id UUID REFERENCES students(user_id) ON DELETE CASCADE, achievement_id UUID REFERENCES achievements(id) ON DELETE CASCADE, earned_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(student_id, achievement_id));
CREATE TABLE audit_logs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), actor_id UUID REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id UUID, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX audit_logs_created_idx ON audit_logs(created_at DESC);
CREATE TABLE refresh_sessions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX refresh_sessions_user_idx ON refresh_sessions(user_id);
CREATE TABLE auth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    purpose TEXT NOT NULL CHECK (purpose IN ('email-verification', 'password-reset', 'password-reset-code')),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_lookup_idx ON auth_tokens(token_hash, purpose, expires_at);

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER users_touch_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER courses_touch_updated_at BEFORE UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER notes_touch_updated_at BEFORE UPDATE ON notes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
