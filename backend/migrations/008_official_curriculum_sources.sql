-- Official source registry only. Curriculum mappings remain draft until verified
-- against the specific published REB/RTB document or e-learning category.
INSERT INTO curriculum_sources (authority, title, url)
VALUES
    ('Rwanda Education Board', 'REB Curriculum, Teaching and Learning Resources', 'https://www.reb.gov.rw/curriculum-teaching-learning-resources-department'),
    ('Rwanda Education Board', 'REB E-Learning Platform', 'https://elearning.reb.rw/course/'),
    ('Rwanda TVET Board', 'RTB Curriculum and Instructional Materials', 'https://www.rtb.gov.rw/curriculum-instructional-materials-development-department'),
    ('Rwanda TVET Board', 'RTB E-Learning Platform', 'https://www.elearning.rtb.gov.rw/course/')
ON CONFLICT (authority, title, url) DO NOTHING;

INSERT INTO curriculum_versions (source_id, version_label, status, notes)
SELECT id, 'source registry - verification required', 'draft', 'Do not publish mappings until the relevant official curriculum or e-learning category has been reviewed.'
FROM curriculum_sources
WHERE (authority, title) IN (
    ('Rwanda Education Board', 'REB Curriculum, Teaching and Learning Resources'),
    ('Rwanda Education Board', 'REB E-Learning Platform'),
    ('Rwanda TVET Board', 'RTB Curriculum and Instructional Materials'),
    ('Rwanda TVET Board', 'RTB E-Learning Platform')
)
ON CONFLICT (source_id, version_label) DO NOTHING;