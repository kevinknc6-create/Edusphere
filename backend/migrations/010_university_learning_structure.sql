-- Additive university catalog structure. Existing programs and library courses remain intact.
CREATE TABLE IF NOT EXISTS university_programs (
    program_id BIGINT PRIMARY KEY REFERENCES programs(id) ON DELETE CASCADE,
    faculty_id BIGINT REFERENCES faculties(id) ON DELETE SET NULL,
    department_id BIGINT REFERENCES departments(id) ON DELETE SET NULL,
    award VARCHAR(160) NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    source_reference TEXT NOT NULL DEFAULT '',
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired'))
);

CREATE TABLE IF NOT EXISTS university_years (
    id BIGSERIAL PRIMARY KEY,
    program_id BIGINT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    year_number INTEGER NOT NULL CHECK (year_number > 0),
    title VARCHAR(120) NOT NULL DEFAULT '',
    UNIQUE(program_id, year_number)
);

CREATE TABLE IF NOT EXISTS university_semesters (
    id BIGSERIAL PRIMARY KEY,
    year_id BIGINT NOT NULL REFERENCES university_years(id) ON DELETE CASCADE,
    semester_number INTEGER NOT NULL CHECK (semester_number > 0),
    title VARCHAR(120) NOT NULL DEFAULT '',
    UNIQUE(year_id, semester_number)
);

CREATE TABLE IF NOT EXISTS university_course_offerings (
    course_id BIGINT NOT NULL REFERENCES library_courses(id) ON DELETE CASCADE,
    program_id BIGINT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    year_id BIGINT REFERENCES university_years(id) ON DELETE CASCADE,
    semester_id BIGINT REFERENCES university_semesters(id) ON DELETE CASCADE,
    course_code VARCHAR(80) NOT NULL DEFAULT '',
    credits NUMERIC(5,2),
    PRIMARY KEY(course_id, program_id)
);

CREATE INDEX IF NOT EXISTS university_years_program_idx ON university_years(program_id, year_number);
CREATE INDEX IF NOT EXISTS university_semesters_year_idx ON university_semesters(year_id, semester_number);
CREATE INDEX IF NOT EXISTS university_offerings_program_idx ON university_course_offerings(program_id, year_id, semester_id);