BEGIN;

ALTER TABLE curriculum_materials
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS source_type VARCHAR(16) NOT NULL DEFAULT 'url'
        CHECK (source_type IN ('upload', 'url')),
    ADD COLUMN IF NOT EXISTS storage_key UUID,
    ADD COLUMN IF NOT EXISTS original_filename VARCHAR(255) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS content_type VARCHAR(120) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS size_bytes BIGINT,
    ADD COLUMN IF NOT EXISTS processing_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
    ADD COLUMN IF NOT EXISTS processing_error TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS content_revision INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS rights_confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS rights_confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS tvet_subject_id BIGINT REFERENCES tvet_subjects(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS curriculum_unit_id BIGINT REFERENCES curriculum_units(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS tvet_unit_id BIGINT REFERENCES tvet_units(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS course_lesson_id BIGINT REFERENCES course_lessons(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS tvet_lesson_id BIGINT REFERENCES tvet_lessons(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE curriculum_materials
    DROP CONSTRAINT IF EXISTS curriculum_materials_material_type_check;
ALTER TABLE curriculum_materials
    ADD CONSTRAINT curriculum_materials_material_type_check
        CHECK (material_type IN ('textbook', 'teacher_guide', 'worksheet', 'digital', 'other', 'notes', 'module', 'learning_guide'));

UPDATE curriculum_materials
SET status = 'draft',
    processing_status = 'failed',
    processing_error = 'Review the source URL and confirm distribution rights before reprocessing this existing material.',
    updated_at = now()
WHERE rights_confirmed_at IS NULL;

UPDATE curriculum_materials
SET source_type = 'url',
    processing_status = CASE WHEN btrim(url) = '' THEN 'failed' ELSE 'pending' END,
    processing_error = CASE WHEN btrim(url) = '' THEN 'Add a public source URL before retrying processing.' ELSE '' END
WHERE rights_confirmed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS learning_material_chunks (
    id BIGSERIAL PRIMARY KEY,
    material_id BIGINT NOT NULL REFERENCES curriculum_materials(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
    content TEXT NOT NULL,
    source_reference TEXT NOT NULL DEFAULT '',
    search_vector TSVECTOR NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(material_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS learning_material_chunks_search_idx
    ON learning_material_chunks USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS learning_materials_processing_idx
    ON curriculum_materials(processing_status, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS learning_materials_scope_idx
    ON curriculum_materials(education_level_id, grade_id, program_id, subject_id, tvet_subject_id, status);
CREATE INDEX IF NOT EXISTS learning_materials_storage_idx
    ON curriculum_materials(storage_key) WHERE storage_key IS NOT NULL;

COMMIT;
