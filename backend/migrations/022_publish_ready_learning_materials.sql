BEGIN;

UPDATE curriculum_materials AS material
SET status = 'published',
    updated_at = now()
WHERE material.status = 'draft'
    AND material.processing_status = 'completed'
    AND material.rights_confirmed_at IS NOT NULL
    AND EXISTS (
        SELECT 1
        FROM school_textbook_assignments assignment
        JOIN admin_schools school ON school.id = assignment.school_id AND school.status = 'active'
        WHERE assignment.material_id = material.id
    );

COMMIT;
