-- Additive student education profile links for scalable onboarding.
ALTER TABLE students
    ADD COLUMN IF NOT EXISTS education_level_id UUID REFERENCES education_levels(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS grade_id UUID REFERENCES grades(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS program_id UUID REFERENCES programs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS students_education_profile_idx
    ON students(education_level_id, grade_id, program_id);
