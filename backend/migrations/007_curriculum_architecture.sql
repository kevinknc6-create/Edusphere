-- Additive curriculum metadata and mappings. No curriculum claims are seeded here.
CREATE TABLE IF NOT EXISTS curriculum_sources (
    id BIGSERIAL PRIMARY KEY,
    authority VARCHAR(160) NOT NULL,
    title VARCHAR(240) NOT NULL,
    url TEXT NOT NULL,
    country_code VARCHAR(10) NOT NULL DEFAULT 'RW',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(authority, title, url)
);

CREATE TABLE IF NOT EXISTS curriculum_versions (
    id BIGSERIAL PRIMARY KEY,
    source_id BIGINT NOT NULL REFERENCES curriculum_sources(id) ON DELETE RESTRICT,
    version_label VARCHAR(120) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
    effective_from DATE,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(source_id, version_label)
);

CREATE TABLE IF NOT EXISTS curriculum_combinations (
    id BIGSERIAL PRIMARY KEY,
    curriculum_version_id BIGINT NOT NULL REFERENCES curriculum_versions(id) ON DELETE CASCADE,
    education_level_id BIGINT NOT NULL REFERENCES education_levels(id) ON DELETE CASCADE,
    code VARCHAR(80) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source_reference TEXT NOT NULL DEFAULT '',
    UNIQUE(curriculum_version_id, education_level_id, code)
);

CREATE TABLE IF NOT EXISTS curriculum_subjects (
    id BIGSERIAL PRIMARY KEY,
    curriculum_version_id BIGINT NOT NULL REFERENCES curriculum_versions(id) ON DELETE CASCADE,
    education_level_id BIGINT NOT NULL REFERENCES education_levels(id) ON DELETE CASCADE,
    grade_id BIGINT REFERENCES grades(id) ON DELETE CASCADE,
    program_id BIGINT REFERENCES programs(id) ON DELETE CASCADE,
    combination_id BIGINT REFERENCES curriculum_combinations(id) ON DELETE CASCADE,
    code VARCHAR(100) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source_reference TEXT NOT NULL DEFAULT '',
    UNIQUE(curriculum_version_id, education_level_id, grade_id, program_id, combination_id, code)
);

CREATE TABLE IF NOT EXISTS curriculum_subject_library_subjects (
    curriculum_subject_id BIGINT NOT NULL REFERENCES curriculum_subjects(id) ON DELETE CASCADE,
    library_subject_id BIGINT NOT NULL REFERENCES library_subjects(id) ON DELETE CASCADE,
    PRIMARY KEY(curriculum_subject_id, library_subject_id)
);

CREATE TABLE IF NOT EXISTS curriculum_subject_courses (
    curriculum_subject_id BIGINT NOT NULL REFERENCES curriculum_subjects(id) ON DELETE CASCADE,
    course_id BIGINT NOT NULL REFERENCES library_courses(id) ON DELETE CASCADE,
    PRIMARY KEY(curriculum_subject_id, course_id)
);

CREATE INDEX IF NOT EXISTS curriculum_subjects_profile_idx
    ON curriculum_subjects(education_level_id, grade_id, program_id, combination_id);

CREATE INDEX IF NOT EXISTS curriculum_versions_status_idx
    ON curriculum_versions(status, effective_from);