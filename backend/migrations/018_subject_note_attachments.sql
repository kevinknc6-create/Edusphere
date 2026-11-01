BEGIN;

ALTER TABLE subject_notes DROP CONSTRAINT IF EXISTS subject_notes_body_check;

CREATE TABLE IF NOT EXISTS subject_note_attachments (
    id BIGSERIAL PRIMARY KEY,
    note_id BIGINT REFERENCES subject_notes(id) ON DELETE CASCADE,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(120) NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    file_data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subject_note_attachments_note_idx
    ON subject_note_attachments(note_id);

COMMIT;
