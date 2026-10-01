-- Dedicated teacher approval and one-time verification-code workflow.
ALTER TABLE teachers
    ADD COLUMN IF NOT EXISTS teacher_verification_status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES admins(user_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejected_reason TEXT;

ALTER TABLE teachers DROP CONSTRAINT IF EXISTS teachers_teacher_verification_status_check;
ALTER TABLE teachers ADD CONSTRAINT teachers_teacher_verification_status_check
    CHECK (teacher_verification_status IN ('pending', 'approved', 'verified', 'suspended', 'rejected'));

UPDATE teachers
SET teacher_verification_status = CASE verification_status::text
    WHEN 'active' THEN 'verified'
    WHEN 'suspended' THEN 'suspended'
    ELSE 'pending'
END
WHERE teacher_verification_status = 'pending';

CREATE TABLE IF NOT EXISTS teacher_verification_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES teachers(user_id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    invalidated_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teacher_verification_codes_lookup_idx
    ON teacher_verification_codes(teacher_id, expires_at DESC)
    WHERE consumed_at IS NULL AND invalidated_at IS NULL;