BEGIN;

CREATE TABLE IF NOT EXISTS class_dashboard_state (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    class_code TEXT NOT NULL CHECK (class_code IN ('S1', 'S2', 'S3')),
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS class_dashboard_state_class_updated_idx
    ON class_dashboard_state(class_code, updated_at DESC);

COMMIT;
