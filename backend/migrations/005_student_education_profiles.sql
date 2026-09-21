-- Additive education profile links for the existing integer user model.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS education_level_id BIGINT REFERENCES education_levels(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS grade_id BIGINT REFERENCES grades(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS program_id BIGINT REFERENCES programs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_education_profile_idx
    ON users(education_level_id, grade_id, program_id);