const express = require("express");
const jwt = require("jsonwebtoken");
const { storagePath } = require("../services/learningMaterials");
const pool = require("../db");

const router = express.Router();

function requireAuth(req, res, next) {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return res.status(401).json({ message: "Authentication required" });
    try {
        const claims = jwt.verify(header.slice(7), process.env.JWT_SECRET);
        req.auth = { userId: claims.id || claims.sub, role: claims.role || "student" };
        next();
    } catch {
        res.status(401).json({ message: "Your session has expired" });
    }
}

function positiveInteger(value, fieldName, nullable = false) {
    if (value === null || value === undefined || value === "") {
        if (nullable) return null;
        return { error: `${fieldName} is required` };
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) return { error: `${fieldName} must be a positive integer` };
    return parsed;
}

router.use(requireAuth);

function classCode(value) { return ["S1", "S2", "S3"].includes(value) ? value : null; }
async function requireMatchingClass(req, res, code) {
    if (req.auth.role !== "student") { res.status(403).json({ message: "Student access required" }); return false; }
    const result = await pool.query("SELECT g.code FROM users u JOIN grades g ON g.id = u.grade_id WHERE u.id = $1", [req.auth.userId]);
    if (!result.rows[0] || !new RegExp(`(?:^|_)${code.slice(1)}$`, "i").test(result.rows[0].code)) {
        res.status(403).json({ message: "This dashboard does not match your registered class" });
        return false;
    }
    return true;
}

router.get("/me/class-dashboard", async (req, res) => {
    const code = classCode(req.query.classCode);
    if (!code) return res.status(400).json({ message: "A supported class code is required" });
    try {
        if (!(await requireMatchingClass(req, res, code))) return;
        const result = await pool.query("SELECT class_code, data, updated_at FROM class_dashboard_state WHERE user_id = $1", [req.auth.userId]);
        const saved = result.rows[0];
        if (saved && saved.class_code !== code) return res.status(403).json({ message: "This dashboard does not match your registered class" });
        return res.json({ data: saved || null });
    } catch (error) {
        console.error("CLASS DASHBOARD READ ERROR:", error);
        return res.status(500).json({ message: "Class dashboard could not be loaded" });
    }
});

router.put("/me/class-dashboard", async (req, res) => {
    const code = classCode(req.body && req.body.classCode);
    const data = req.body && req.body.data;
    if (!code || !data || typeof data !== "object" || Array.isArray(data)) return res.status(400).json({ message: "Valid class dashboard data is required" });
    if (JSON.stringify(data).length > 500000) return res.status(413).json({ message: "Class dashboard data is too large" });
    try {
        if (!(await requireMatchingClass(req, res, code))) return;
        const result = await pool.query(`INSERT INTO class_dashboard_state (user_id, class_code, data, updated_at)
            VALUES ($1, $2, $3::jsonb, now())
            ON CONFLICT (user_id) DO UPDATE SET class_code = EXCLUDED.class_code, data = EXCLUDED.data, updated_at = now()
            RETURNING class_code, data, updated_at`, [req.auth.userId, code, JSON.stringify(data)]);
        return res.json({ data: result.rows[0] });
    } catch (error) {
        console.error("CLASS DASHBOARD SAVE ERROR:", error);
        return res.status(500).json({ message: "Class dashboard could not be saved" });
    }
});

router.get("/me/education-profile", async (req, res) => {
    try {
        const result = await pool.query(`
      SELECT u.education_level_id, u.grade_id, u.program_id,
             NULLIF(to_jsonb(u)->>'school_id', '')::bigint AS school_id, school.name AS school_name, school.status AS school_status,
             u.subject_combination_id, combination.name AS subject_combination_name,
             el.name AS education_level_name, el.category AS education_level_category, g.name AS grade_name, p.name AS program_name,
             COALESCE((to_jsonb(u) ? 'school_id') AND EXISTS (
                 SELECT 1 FROM admin_schools WHERE status = 'active'
             ), false) AS school_assignment_required
      FROM users u
      LEFT JOIN education_levels el ON el.id = u.education_level_id
      LEFT JOIN grades g ON g.id = u.grade_id
      LEFT JOIN programs p ON p.id = u.program_id
      LEFT JOIN admin_schools school ON school.id = NULLIF(to_jsonb(u)->>'school_id', '')::bigint
      LEFT JOIN curriculum_combinations combination ON combination.id = u.subject_combination_id
      WHERE u.id = $1`, [req.auth.userId]);
        res.json({ data: result.rows[0] || null });
    } catch (error) {
        console.error("EDUCATION PROFILE READ ERROR:", error.message);
        res.status(500).json({ message: "Education profile is temporarily unavailable." });
    }
});

router.get("/me/learning-dashboard", async (req, res) => {
    try {
        const profileResult = await pool.query(`
            SELECT u.education_level_id, u.grade_id, u.program_id, u.subject_combination_id,
                         el.name AS education_level_name, el.category AS education_level_category, g.name AS grade_name, p.name AS program_name,
                         school.id AS school_id, school.name AS school_name,
                         combination.name AS subject_combination_name
            FROM users u
            LEFT JOIN education_levels el ON el.id = u.education_level_id
            LEFT JOIN grades g ON g.id = u.grade_id
            LEFT JOIN programs p ON p.id = u.program_id
            LEFT JOIN admin_schools school ON school.id = u.school_id AND school.status = 'active'
            LEFT JOIN curriculum_combinations combination ON combination.id = u.subject_combination_id
            WHERE u.id = $1`, [req.auth.userId]);
        const profile = profileResult.rows[0] || null;
        if (!profile) return res.status(404).json({ message: "User account not found" });
        if (!profile.school_id) return res.status(403).json({ message: "An active school assignment is required to access the student dashboard." });

        const [curriculum, subjects, courses, notes, exercises, quizzes, progress, homework, units, outcomes, materials] = await Promise.all([
            pool.query(`
                SELECT cs.id, cs.code, cs.name, cs.description, cs.source_reference,
                             cv.version_label, cv.effective_from, csrc.authority, csrc.title AS source_title, csrc.url AS source_url
                FROM curriculum_subjects cs
                JOIN curriculum_versions cv ON cv.id = cs.curriculum_version_id AND cv.status = 'active'
                JOIN curriculum_sources csrc ON csrc.id = cv.source_id AND csrc.verification_status = 'verified'
                WHERE cs.education_level_id = $1
                    AND (cs.grade_id IS NULL OR cs.grade_id = $2)
                    AND (cs.program_id IS NULL OR cs.program_id = $3)
                    AND (cs.combination_id IS NULL OR cs.combination_id = $4)
                ORDER BY cs.name`, [profile.education_level_id, profile.grade_id, profile.program_id, profile.subject_combination_id]),
            pool.query(`
                SELECT DISTINCT cs.id, cs.name, cs.description
                FROM student_curriculum_enrollments enrollment
                JOIN curriculum_subjects cs ON cs.id = enrollment.curriculum_subject_id
                JOIN curriculum_versions cv ON cv.id = cs.curriculum_version_id AND cv.status = 'active'
                JOIN curriculum_sources source ON source.id = cv.source_id AND source.verification_status = 'verified'
                WHERE enrollment.student_id = $1 AND enrollment.status = 'active'
                    AND cs.education_level_id = $2
                    AND (cs.grade_id IS NULL OR cs.grade_id = $3)
                    AND (cs.program_id IS NULL OR cs.program_id = $4)
                    AND (cs.combination_id IS NULL OR cs.combination_id = $5)
                ORDER BY cs.name`, [req.auth.userId, profile.education_level_id, profile.grade_id, profile.program_id, profile.subject_combination_id]),
            pool.query(`
                SELECT c.id, c.title, c.description, c.difficulty, c.status,
                             c.education_level_id, c.grade_id, c.program_id,
                             s.name AS subject, u.name AS teacher,
                             COUNT(DISTINCT l.id)::int AS lessons
                FROM library_courses c
                JOIN library_subjects s ON s.id = c.subject_id
                LEFT JOIN users u ON u.id = c.teacher_id
                LEFT JOIN course_modules m ON m.course_id = c.id AND m.status = 'published'
                LEFT JOIN course_lessons l ON l.module_id = m.id AND l.status = 'published'
                WHERE c.status = 'published' AND c.education_level_id = $1 AND c.grade_id IS NOT DISTINCT FROM $2::bigint AND c.program_id IS NOT DISTINCT FROM $3::bigint AND (c.school_id IS NULL OR c.school_id = $4)
                GROUP BY c.id, s.name, u.name
                ORDER BY c.updated_at DESC, c.title`, [profile.education_level_id, profile.grade_id, profile.program_id, profile.school_id]),
            pool.query(`
                SELECT n.id, n.title, n.body, n.lesson_id, c.title AS course_title
                FROM lesson_notes n
                JOIN course_lessons l ON l.id = n.lesson_id
                JOIN course_modules m ON m.id = l.module_id
                JOIN library_courses c ON c.id = m.course_id
                WHERE c.status = 'published' AND m.status = 'published' AND l.status = 'published' AND n.status = 'published' AND c.education_level_id = $1 AND c.grade_id IS NOT DISTINCT FROM $2::bigint AND c.program_id IS NOT DISTINCT FROM $3::bigint AND (c.school_id IS NULL OR c.school_id = $4)
                ORDER BY n.position, n.id`, [profile.education_level_id, profile.grade_id, profile.program_id, profile.school_id]),
            pool.query(`
                SELECT x.id, x.prompt, x.answer, x.lesson_id, c.title AS course_title
                FROM lesson_exercises x
                JOIN course_lessons l ON l.id = x.lesson_id
                JOIN course_modules m ON m.id = l.module_id
                JOIN library_courses c ON c.id = m.course_id
                WHERE c.status = 'published' AND m.status = 'published' AND l.status = 'published' AND x.status = 'published' AND c.education_level_id = $1 AND c.grade_id IS NOT DISTINCT FROM $2::bigint AND c.program_id IS NOT DISTINCT FROM $3::bigint AND (c.school_id IS NULL OR c.school_id = $4)
                ORDER BY x.position, x.id`, [profile.education_level_id, profile.grade_id, profile.program_id, profile.school_id]),
            pool.query(`
                SELECT q.id, q.title, q.course_id, c.title AS course_title, q.lesson_id
                FROM library_quizzes q
                JOIN library_courses c ON c.id = q.course_id
                WHERE c.status = 'published' AND q.status = 'published' AND q.published = true AND c.education_level_id = $1 AND c.grade_id IS NOT DISTINCT FROM $2::bigint AND c.program_id IS NOT DISTINCT FROM $3::bigint AND (c.school_id IS NULL OR c.school_id = $4)
                ORDER BY q.id`, [profile.education_level_id, profile.grade_id, profile.program_id, profile.school_id]),
            pool.query(`
                SELECT e.course_id, c.title AS course_title, COUNT(DISTINCT l.id)::int AS total_lessons,
                             COUNT(lp.lesson_id) FILTER (WHERE lp.completed_at IS NOT NULL)::int AS completed_lessons
                FROM library_enrollments e
                JOIN library_courses c ON c.id = e.course_id
                LEFT JOIN course_modules m ON m.course_id = c.id AND m.status = 'published'
                LEFT JOIN course_lessons l ON l.module_id = m.id AND l.status = 'published'
                LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.student_id = e.student_id
                WHERE e.student_id = $1 AND c.status = 'published' AND c.education_level_id = $2 AND c.grade_id IS NOT DISTINCT FROM $3::bigint AND c.program_id IS NOT DISTINCT FROM $4::bigint AND (c.school_id IS NULL OR c.school_id = $5)
                GROUP BY e.course_id, c.title`, [req.auth.userId, profile.education_level_id, profile.grade_id, profile.program_id, profile.school_id]),
            pool.query(`SELECT a.id, a.course_id, a.title, a.instructions, a.due_at, a.total_marks, 'pending' AS status
                FROM library_assessments a JOIN library_courses c ON c.id = a.course_id
                WHERE a.kind = 'homework' AND a.status = 'published' AND c.status = 'published'
                    AND c.education_level_id = $1 AND c.grade_id IS NOT DISTINCT FROM $2::bigint AND c.program_id IS NOT DISTINCT FROM $3::bigint AND (c.school_id IS NULL OR c.school_id = $4)
                ORDER BY a.due_at NULLS LAST, a.id`, [profile.education_level_id, profile.grade_id, profile.program_id, profile.school_id]),
            pool.query(`SELECT u.id, u.curriculum_subject_id, u.title, u.description, s.name AS subject_name
                FROM curriculum_units u
                JOIN curriculum_subjects s ON s.id = u.curriculum_subject_id
                JOIN curriculum_versions v ON v.id = s.curriculum_version_id AND v.status = 'active'
                JOIN curriculum_sources src ON src.id = v.source_id AND src.verification_status = 'verified'
                WHERE u.status = 'published' AND s.education_level_id = $1
                    AND (s.grade_id IS NULL OR s.grade_id = $2)
                    AND (s.program_id IS NULL OR s.program_id = $3)
                    AND (s.combination_id IS NULL OR s.combination_id = $4)
                ORDER BY s.name, u.position, u.title`, [profile.education_level_id, profile.grade_id, profile.program_id, profile.subject_combination_id]),
            pool.query(`SELECT o.id, o.unit_id, o.description, u.title AS unit_title
                FROM curriculum_learning_outcomes o
                JOIN curriculum_units u ON u.id = o.unit_id AND u.status = 'published'
                JOIN curriculum_subjects s ON s.id = u.curriculum_subject_id
                JOIN curriculum_versions v ON v.id = s.curriculum_version_id AND v.status = 'active'
                JOIN curriculum_sources src ON src.id = v.source_id AND src.verification_status = 'verified'
                WHERE o.status = 'published' AND s.education_level_id = $1
                    AND (s.grade_id IS NULL OR s.grade_id = $2)
                    AND (s.program_id IS NULL OR s.program_id = $3)
                    AND (s.combination_id IS NULL OR s.combination_id = $4)
                ORDER BY s.name, u.position, o.position`, [profile.education_level_id, profile.grade_id, profile.program_id, profile.subject_combination_id]),
            pool.query(`SELECT m.id, m.title, m.description, m.material_type, m.publisher, m.edition,
                    m.source_type, m.url, m.original_filename, m.processing_status,
                    COALESCE(s.name, tvet_subject.name) AS subject_name,
                    COALESCE(curriculum_unit.title, tvet_unit.title) AS unit_name,
                    COALESCE(course_lesson.title, tvet_lesson.title) AS lesson_name
                FROM curriculum_materials m
                LEFT JOIN curriculum_versions v ON v.id = m.curriculum_version_id
                LEFT JOIN curriculum_sources src ON src.id = v.source_id
                LEFT JOIN curriculum_subjects s ON s.id = m.subject_id
                LEFT JOIN tvet_subjects tvet_subject ON tvet_subject.id = m.tvet_subject_id
                LEFT JOIN curriculum_units curriculum_unit ON curriculum_unit.id = m.curriculum_unit_id
                LEFT JOIN tvet_units tvet_unit ON tvet_unit.id = m.tvet_unit_id
                LEFT JOIN course_lessons course_lesson ON course_lesson.id = m.course_lesson_id
                LEFT JOIN tvet_lessons tvet_lesson ON tvet_lesson.id = m.tvet_lesson_id
                LEFT JOIN tvet_modules tvet_module ON tvet_module.id = tvet_unit.module_id
                JOIN school_textbook_assignments assignment ON assignment.material_id = m.id AND assignment.school_id = $4
                JOIN admin_schools assigned_school ON assigned_school.id = assignment.school_id AND assigned_school.status = 'active'
                WHERE m.status = 'published' AND m.processing_status = 'completed' AND m.rights_confirmed_at IS NOT NULL AND m.education_level_id = $1
                    AND (m.curriculum_version_id IS NULL OR (v.status = 'active' AND src.verification_status = 'verified'))
                    AND (m.grade_id IS NULL OR m.grade_id = $2)
                    AND (m.program_id IS NULL OR m.program_id = $3)
                    AND (m.subject_id IS NULL OR m.tvet_subject_id IS NULL)
                    AND ((m.subject_id IS NULL AND m.tvet_subject_id IS NULL)
                         OR EXISTS (SELECT 1 FROM student_curriculum_enrollments enrollment
                            JOIN curriculum_subjects enrolled_subject ON enrolled_subject.id = enrollment.curriculum_subject_id
                            WHERE enrollment.student_id = $5 AND enrollment.status = 'active'
                                AND enrolled_subject.id = m.subject_id
                                AND enrolled_subject.education_level_id = $1
                                AND (enrolled_subject.grade_id IS NULL OR enrolled_subject.grade_id = $2)
                                AND (enrolled_subject.program_id IS NULL OR enrolled_subject.program_id = $3)
                                AND (enrolled_subject.combination_id IS NULL OR enrolled_subject.combination_id = $6))
                         OR EXISTS (SELECT 1 FROM tvet_subjects ts
                            WHERE ts.id = m.tvet_subject_id AND ts.curriculum_version_id = m.curriculum_version_id
                                AND ts.program_id = $3 AND ts.grade_id = $2
                                AND ts.status = 'published'
                                AND EXISTS (SELECT 1 FROM curriculum_versions tv JOIN curriculum_sources source ON source.id = tv.source_id
                                    WHERE tv.id = ts.curriculum_version_id AND tv.status = 'active' AND source.verification_status = 'verified')))
                    AND (m.course_lesson_id IS NULL OR (course_lesson.status = 'published'
                        AND EXISTS (SELECT 1 FROM course_modules module JOIN library_courses course ON course.id = module.course_id
                            WHERE module.id = course_lesson.module_id AND module.status = 'published' AND course.status = 'published')))
                    AND (m.tvet_lesson_id IS NULL OR (tvet_lesson.status = 'published'
                        AND EXISTS (SELECT 1 FROM tvet_units unit JOIN tvet_modules module ON module.id = unit.module_id
                            JOIN tvet_competences competence ON competence.id = module.competence_id
                            WHERE unit.id = tvet_lesson.unit_id AND competence.subject_id = m.tvet_subject_id
                                AND unit.status = 'published' AND module.status = 'published' AND competence.status = 'published')))
                    AND (m.curriculum_unit_id IS NULL OR curriculum_unit.status = 'published')
                    AND (m.tvet_unit_id IS NULL OR (tvet_unit.status = 'published' AND tvet_module.status = 'published'))
                    AND (m.tvet_unit_id IS NULL OR EXISTS (
                        SELECT 1 FROM tvet_units unit JOIN tvet_modules module ON module.id = unit.module_id
                            JOIN tvet_competences competence ON competence.id = module.competence_id
                        WHERE unit.id = m.tvet_unit_id AND competence.subject_id = m.tvet_subject_id
                            AND unit.status = 'published' AND module.status = 'published' AND competence.status = 'published'))
                ORDER BY m.material_type, m.title`, [profile.education_level_id, profile.grade_id, profile.program_id, profile.school_id, req.auth.userId, profile.subject_combination_id]),
        ]);
        res.json({ data: { profile, curriculum: curriculum.rows, subjects: subjects.rows, courses: courses.rows, materials: materials.rows, units: units.rows, outcomes: outcomes.rows, notes: notes.rows, exercises: exercises.rows, quizzes: quizzes.rows, tests: [], exams: [], homework: homework.rows, results: [], progress: progress.rows } });
    } catch (error) {
        console.error("LEARNING DASHBOARD ERROR:", error.message);
        res.status(500).json({ message: "Learning dashboard is temporarily unavailable." });
    }
});

router.get("/me/tvet-dashboard", async (req, res) => {
    try {
        const profileResult = await pool.query(`
      SELECT u.education_level_id, u.grade_id, u.program_id, u.school_id,
             el.name AS education_level_name, g.name AS grade_name, p.name AS program_name
             , school.name AS school_name
      FROM users u
      LEFT JOIN education_levels el ON el.id = u.education_level_id
      LEFT JOIN grades g ON g.id = u.grade_id
      LEFT JOIN programs p ON p.id = u.program_id
      LEFT JOIN admin_schools school ON school.id = u.school_id AND school.status = 'active'
      WHERE u.id = $1`, [req.auth.userId]);
        const profile = profileResult.rows[0] || null;
        if (!profile?.program_id || !profile.grade_id) return res.status(400).json({ message: "Select a TVET level and program first" });

        const [subjects, competences, modules, units, lessons, practicals, assessments, learningOutcomes, materials] = await Promise.all([
            pool.query("SELECT id, code, name, description, source_reference FROM tvet_subjects s WHERE program_id = $1 AND grade_id = $2 AND status = 'published' AND EXISTS (SELECT 1 FROM curriculum_versions cv JOIN curriculum_sources src ON src.id = cv.source_id WHERE cv.id = s.curriculum_version_id AND cv.status = 'active' AND src.verification_status = 'verified') ORDER BY name", [profile.program_id, profile.grade_id]),
            pool.query("SELECT c.id, c.subject_id, c.code, c.title, c.description, c.position FROM tvet_competences c JOIN tvet_subjects s ON s.id = c.subject_id WHERE s.program_id = $1 AND s.grade_id = $2 AND s.status = 'published' AND EXISTS (SELECT 1 FROM curriculum_versions cv JOIN curriculum_sources src ON src.id = cv.source_id WHERE cv.id = s.curriculum_version_id AND cv.status = 'active' AND src.verification_status = 'verified') AND c.status = 'published' ORDER BY c.position, c.title", [profile.program_id, profile.grade_id]),
            pool.query("SELECT m.id, m.competence_id, m.title, m.description, m.position FROM tvet_modules m JOIN tvet_competences c ON c.id = m.competence_id JOIN tvet_subjects s ON s.id = c.subject_id WHERE s.program_id = $1 AND s.grade_id = $2 AND s.status = 'published' AND EXISTS (SELECT 1 FROM curriculum_versions cv JOIN curriculum_sources src ON src.id = cv.source_id WHERE cv.id = s.curriculum_version_id AND cv.status = 'active' AND src.verification_status = 'verified') AND c.status = 'published' AND m.status = 'published' ORDER BY m.position, m.title", [profile.program_id, profile.grade_id]),
            pool.query("SELECT u.id, u.module_id, u.title, u.description, u.position FROM tvet_units u JOIN tvet_modules m ON m.id = u.module_id JOIN tvet_competences c ON c.id = m.competence_id JOIN tvet_subjects s ON s.id = c.subject_id WHERE s.program_id = $1 AND s.grade_id = $2 AND s.status = 'published' AND EXISTS (SELECT 1 FROM curriculum_versions cv JOIN curriculum_sources src ON src.id = cv.source_id WHERE cv.id = s.curriculum_version_id AND cv.status = 'active' AND src.verification_status = 'verified') AND c.status = 'published' AND m.status = 'published' AND u.status = 'published' ORDER BY u.position, u.title", [profile.program_id, profile.grade_id]),
            pool.query("SELECT l.id, l.unit_id, l.title, l.content, l.duration_minutes, l.position FROM tvet_lessons l JOIN tvet_units u ON u.id = l.unit_id JOIN tvet_modules m ON m.id = u.module_id JOIN tvet_competences c ON c.id = m.competence_id JOIN tvet_subjects s ON s.id = c.subject_id WHERE s.program_id = $1 AND s.grade_id = $2 AND s.status = 'published' AND EXISTS (SELECT 1 FROM curriculum_versions cv JOIN curriculum_sources src ON src.id = cv.source_id WHERE cv.id = s.curriculum_version_id AND cv.status = 'active' AND src.verification_status = 'verified') AND c.status = 'published' AND m.status = 'published' AND u.status = 'published' AND l.status = 'published' ORDER BY l.position, l.title", [profile.program_id, profile.grade_id]),
            pool.query("SELECT p.id, p.lesson_id, p.title, p.instructions, p.resources, p.position FROM tvet_practical_exercises p JOIN tvet_lessons l ON l.id = p.lesson_id JOIN tvet_units u ON u.id = l.unit_id JOIN tvet_modules m ON m.id = u.module_id JOIN tvet_competences c ON c.id = m.competence_id JOIN tvet_subjects s ON s.id = c.subject_id WHERE s.program_id = $1 AND s.grade_id = $2 AND s.status = 'published' AND EXISTS (SELECT 1 FROM curriculum_versions cv JOIN curriculum_sources src ON src.id = cv.source_id WHERE cv.id = s.curriculum_version_id AND cv.status = 'active' AND src.verification_status = 'verified') AND c.status = 'published' AND m.status = 'published' AND u.status = 'published' AND l.status = 'published' ORDER BY p.position, p.title", [profile.program_id, profile.grade_id]),
            pool.query("SELECT a.id, a.type, a.title, a.instructions, a.time_limit_seconds, a.lesson_id FROM tvet_assessments a JOIN programs p ON p.id = a.program_id WHERE a.program_id = $1 AND a.grade_id = $2 AND a.status = 'published' AND p.curriculum_verification_status = 'verified' ORDER BY a.type, a.title", [profile.program_id, profile.grade_id]),
            pool.query("SELECT o.id, o.unit_id, o.description, u.title AS unit_title FROM tvet_learning_outcomes o JOIN tvet_units u ON u.id = o.unit_id AND u.status = 'published' JOIN tvet_modules m ON m.id = u.module_id AND m.status = 'published' JOIN tvet_competences c ON c.id = m.competence_id AND c.status = 'published' JOIN tvet_subjects s ON s.id = c.subject_id AND s.status = 'published' JOIN curriculum_versions cv ON cv.id = s.curriculum_version_id AND cv.status = 'active' JOIN curriculum_sources src ON src.id = cv.source_id AND src.verification_status = 'verified' WHERE s.program_id = $1 AND s.grade_id = $2 AND o.status = 'published' ORDER BY u.position, o.position", [profile.program_id, profile.grade_id]),
            pool.query(`SELECT m.id, m.title, m.description, m.material_type, m.source_type, m.url,
                    m.original_filename, m.processing_status, s.name AS subject_name,
                    u.title AS unit_name, l.title AS lesson_name
                FROM curriculum_materials m
                LEFT JOIN curriculum_versions v ON v.id = m.curriculum_version_id
                LEFT JOIN curriculum_sources src ON src.id = v.source_id
                JOIN school_textbook_assignments assignment ON assignment.material_id = m.id AND assignment.school_id = $3
                JOIN admin_schools assigned_school ON assigned_school.id = assignment.school_id AND assigned_school.status = 'active'
                LEFT JOIN tvet_subjects s ON s.id = m.tvet_subject_id
                LEFT JOIN tvet_units u ON u.id = m.tvet_unit_id
                LEFT JOIN tvet_lessons l ON l.id = m.tvet_lesson_id
                LEFT JOIN tvet_modules module ON module.id = u.module_id
                WHERE m.status = 'published' AND m.processing_status = 'completed' AND m.rights_confirmed_at IS NOT NULL
                    AND (m.curriculum_version_id IS NULL OR (v.status = 'active' AND src.verification_status = 'verified'))
                    AND m.education_level_id = $4 AND (m.grade_id IS NULL OR m.grade_id = $2)
                    AND (m.program_id IS NULL OR m.program_id = $1)
                    AND m.subject_id IS NULL
                    AND (m.tvet_subject_id IS NULL OR (s.program_id = $1 AND s.grade_id = $2
                        AND s.curriculum_version_id = m.curriculum_version_id AND s.status = 'published'))
                    AND (m.tvet_unit_id IS NULL OR u.status = 'published')
                    AND (m.tvet_unit_id IS NULL OR module.status = 'published')
                    AND (m.tvet_lesson_id IS NULL OR (l.status = 'published' AND EXISTS (
                        SELECT 1 FROM tvet_units lesson_unit JOIN tvet_modules lesson_module ON lesson_module.id = lesson_unit.module_id
                            JOIN tvet_competences lesson_competence ON lesson_competence.id = lesson_module.competence_id
                        WHERE lesson_unit.id = l.unit_id AND lesson_competence.subject_id = m.tvet_subject_id
                            AND lesson_unit.status = 'published' AND lesson_module.status = 'published'
                            AND lesson_competence.status = 'published')))
                    AND (m.tvet_unit_id IS NULL OR EXISTS (
                        SELECT 1 FROM tvet_units assigned_unit JOIN tvet_modules assigned_module ON assigned_module.id = assigned_unit.module_id
                            JOIN tvet_competences assigned_competence ON assigned_competence.id = assigned_module.competence_id
                        WHERE assigned_unit.id = m.tvet_unit_id AND assigned_competence.subject_id = m.tvet_subject_id
                            AND assigned_unit.status = 'published' AND assigned_module.status = 'published'
                            AND assigned_competence.status = 'published'))
                ORDER BY m.material_type, m.title`, [profile.program_id, profile.grade_id, profile.school_id, profile.education_level_id]),
        ]);
        res.json({ data: { profile, subjects: subjects.rows, competences: competences.rows, modules: modules.rows, units: units.rows, learningOutcomes: learningOutcomes.rows, lessons: lessons.rows, practicalExercises: practicals.rows, assessments: assessments.rows, materials: materials.rows, notes: [], exercises: [], quizzes: assessments.rows.filter((item) => item.type === 'quiz'), tests: assessments.rows.filter((item) => item.type === 'test'), exams: assessments.rows.filter((item) => item.type === 'exam'), assignments: [], results: [], progress: [] } });
    } catch (error) {
        console.error("TVET DASHBOARD ERROR:", error.message);
        res.status(500).json({ message: "TVET dashboard is temporarily unavailable." });
    }
});

router.get("/me/university-dashboard", async (req, res) => {
    try {
        const profileResult = await pool.query(`
      SELECT u.education_level_id, u.grade_id, u.program_id,
             el.name AS education_level_name, p.name AS program_name,
             f.id AS faculty_id, f.name AS faculty_name,
             d.id AS department_id, d.name AS department_name
      FROM users u
      LEFT JOIN education_levels el ON el.id = u.education_level_id
      LEFT JOIN programs p ON p.id = u.program_id
      LEFT JOIN departments d ON d.id = p.department_id
      LEFT JOIN faculties f ON f.id = d.faculty_id
      WHERE u.id = $1`, [req.auth.userId]);
        const profile = profileResult.rows[0] || null;
        if (!profile?.program_id) return res.status(400).json({ message: "Select a university program first" });
        const [program, years, semesters, courses] = await Promise.all([
            pool.query("SELECT up.program_id, up.award, up.description, up.source_reference, f.name AS faculty_name, d.name AS department_name FROM university_programs up LEFT JOIN faculties f ON f.id = up.faculty_id LEFT JOIN departments d ON d.id = up.department_id WHERE up.program_id = $1 AND up.status = 'published'", [profile.program_id]),
            pool.query("SELECT id, year_number, title FROM university_years WHERE program_id = $1 ORDER BY year_number", [profile.program_id]),
            pool.query("SELECT s.id, s.year_id, s.semester_number, s.title FROM university_semesters s JOIN university_years y ON y.id = s.year_id WHERE y.program_id = $1 ORDER BY y.year_number, s.semester_number", [profile.program_id]),
            pool.query(`
        SELECT c.id, c.title, c.description, c.difficulty, c.program_id, s.name AS subject,
               o.course_code, o.credits, o.year_id, o.semester_id, COUNT(DISTINCT l.id)::int AS lessons
        FROM library_courses c
        JOIN library_subjects s ON s.id = c.subject_id
        LEFT JOIN university_course_offerings o ON o.course_id = c.id AND o.program_id = $1
        LEFT JOIN course_modules m ON m.course_id = c.id
        LEFT JOIN course_lessons l ON l.module_id = m.id
        WHERE c.status = 'published' AND c.program_id = $1
        GROUP BY c.id, s.name, o.course_code, o.credits, o.year_id, o.semester_id
        ORDER BY o.year_id NULLS LAST, o.semester_id NULLS LAST, c.title`, [profile.program_id]),
        ]);
        res.json({ data: { profile, program: program.rows[0] || null, years: years.rows, semesters: semesters.rows, courses: courses.rows, modules: [], lessons: [], notes: [], exercises: [], quizzes: [], tests: [], exams: [], results: [], progress: [] } });
    } catch (error) {
        console.error("UNIVERSITY DASHBOARD ERROR:", error.message);
        res.status(500).json({ message: "University dashboard is temporarily unavailable." });
    }
});

router.delete("/me/education-profile", async (req, res) => {
    return res.status(403).json({ message: "Class and program assignments must be changed by an administrator." });
});

router.patch("/me/education-profile", async (req, res) => {
    if (req.auth.role !== "student") return res.status(403).json({ message: "Student access required" });
    const educationLevelId = positiveInteger(req.body.educationLevelId, "educationLevelId");
    const gradeId = positiveInteger(req.body.gradeId, "gradeId", true);
    const programId = positiveInteger(req.body.programId, "programId", true);
    const requestedSchoolId = positiveInteger(req.body.schoolId, "schoolId", true);
    const validationError = [educationLevelId, gradeId, programId, requestedSchoolId].find((value) => value && value.error);
    if (validationError) return res.status(400).json({ message: validationError.error });

    const client = await pool.connect();
    let committed = false;
    try {
        await client.query("BEGIN");
        const account = await client.query(`SELECT role, status, school_id, education_level_id, grade_id, program_id
            FROM users WHERE id = $1 FOR UPDATE`, [req.auth.userId]);
        const current = account.rows[0];
        if (!current || current.status !== "active") {
            await client.query("ROLLBACK");
            return res.status(401).json({ message: "Active student account required" });
        }
        if (current.role !== "student") {
            await client.query("ROLLBACK");
            return res.status(403).json({ message: "Student access required" });
        }

        const level = await client.query("SELECT id FROM education_levels WHERE id = $1", [educationLevelId]);
        if (!level.rows[0]) {
            await client.query("ROLLBACK");
            return res.status(400).json({ message: "The selected education level is not available" });
        }
        if (gradeId !== null) {
            const grade = await client.query("SELECT id FROM grades WHERE id = $1 AND education_level_id = $2", [gradeId, educationLevelId]);
            if (!grade.rows[0]) {
                await client.query("ROLLBACK");
                return res.status(400).json({ message: "The selected grade does not belong to that education level" });
            }
        }

        if (programId !== null) {
            const program = await client.query(`
        SELECT p.id
        FROM programs p
        LEFT JOIN tvet_program_levels tpl ON tpl.program_id = p.id
        WHERE p.id = $1
          AND ($2::bigint IS NULL OR tpl.grade_id = $2 OR NOT EXISTS (SELECT 1 FROM tvet_program_levels WHERE program_id = p.id))`, [programId, gradeId]);
            if (!program.rows[0]) {
                await client.query("ROLLBACK");
                return res.status(400).json({ message: "The selected program is not available" });
            }
        }

        const schoolColumn = await client.query(`SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'school_id'
        ) AS available`);
        if (!schoolColumn.rows[0].available) {
            await client.query("ROLLBACK");
            return res.status(503).json({ message: "School assignment is not available until the student school migration is applied." });
        }
        if (current.school_id && requestedSchoolId && String(current.school_id) !== String(requestedSchoolId)) {
            await client.query("ROLLBACK");
            return res.status(403).json({ message: "Only an administrator can change your assigned school." });
        }
        const schoolId = current.school_id || requestedSchoolId;
        if (!schoolId) {
            await client.query("ROLLBACK");
            return res.status(400).json({ message: "Choose an active school to continue." });
        }
        const school = await client.query("SELECT id FROM admin_schools WHERE id = $1 AND status = 'active'", [schoolId]);
        if (!school.rows[0]) {
            await client.query("ROLLBACK");
            return res.status(400).json({ message: "Choose an active school from the list." });
        }
        const result = await client.query(`UPDATE users
            SET education_level_id = $1, grade_id = $2, program_id = $3,
                school_id = $4,
                subject_combination_id = CASE
                    WHEN education_level_id IS DISTINCT FROM $1 OR grade_id IS DISTINCT FROM $2
                         OR program_id IS DISTINCT FROM $3 THEN NULL
                    ELSE subject_combination_id
                END
            WHERE id = $5
            RETURNING education_level_id, grade_id, program_id, school_id`,
        [educationLevelId, gradeId, programId, schoolId, req.auth.userId]);
        const academicAssignmentChanged = ["education_level_id", "grade_id", "program_id"].some((field) =>
            String(current[field] ?? "") !== String(({ education_level_id: educationLevelId, grade_id: gradeId, program_id: programId })[field] ?? ""));
        if (academicAssignmentChanged) {
            await client.query("UPDATE student_curriculum_enrollments SET status = 'ended' WHERE student_id = $1 AND status = 'active'", [req.auth.userId]);
        }
        await client.query("COMMIT");
        committed = true;
        return res.json({ data: result.rows[0] });
    } catch (error) {
        if (!committed) await client.query("ROLLBACK").catch(() => {});
        console.error("EDUCATION PROFILE UPDATE ERROR:", error.message);
        return res.status(500).json({ message: "Education profile could not be saved." });
    } finally {
        client.release();
    }
});

router.get("/subjects/:subjectId/notes", async (req, res) => {
    if (req.auth.role !== "student") return res.status(403).json({ message: "Student access required" });
    const subjectId = positiveInteger(req.params.subjectId, "Subject");
    if (!subjectId) return res.status(400).json({ message: "A valid subject is required" });
    try {
        const result = await pool.query(`SELECT n.id, n.title, n.topic, n.body, n.created_at, n.updated_at,
                (SELECT COALESCE(json_agg(json_build_object('id', a.id, 'name', a.name, 'type', a.mime_type, 'size', a.size_bytes) ORDER BY a.created_at), '[]'::json)
                 FROM subject_note_attachments a WHERE a.note_id = n.id) AS attachments
            FROM subject_notes n
            JOIN users student ON student.id = $1 AND student.role = 'student'
            JOIN admin_schools school ON school.id = student.school_id AND school.status = 'active'
            WHERE n.subject_id = $2
              AND n.school_id = student.school_id
              AND n.education_level_id = student.education_level_id
              AND n.grade_id IS NOT DISTINCT FROM student.grade_id
              AND n.program_id IS NOT DISTINCT FROM student.program_id
              AND n.status = 'published'
              AND EXISTS (
                  SELECT 1 FROM library_courses course
                  WHERE course.subject_id = n.subject_id AND course.status = 'published'
                    AND course.education_level_id = student.education_level_id
                    AND course.grade_id IS NOT DISTINCT FROM student.grade_id
                    AND course.program_id IS NOT DISTINCT FROM student.program_id
              )
            ORDER BY n.created_at DESC, n.id`, [req.auth.userId, subjectId]);
        return res.json({ data: result.rows });
    } catch (error) {
        console.error("SUBJECT NOTES READ ERROR:", error.message);
        return res.status(500).json({ message: "Subject notes could not be loaded." });
    }
});

router.get("/materials/:materialId/file", async (req, res) => {
    if (req.auth.role !== "student") return res.status(403).json({ message: "Student access required" });
    const materialId = positiveInteger(req.params.materialId, "Material");
    if (!Number.isInteger(materialId)) return res.status(400).json({ message: "A valid learning material is required." });
    try {
        const result = await pool.query(`SELECT m.storage_key, m.original_filename
            FROM curriculum_materials m
            JOIN users student ON student.id = $1 AND student.role = 'student' AND student.status = 'active'
            JOIN admin_schools school ON school.id = student.school_id AND school.status = 'active'
            JOIN school_textbook_assignments assignment ON assignment.material_id = m.id AND assignment.school_id = student.school_id
            LEFT JOIN curriculum_versions version ON version.id = m.curriculum_version_id
            LEFT JOIN curriculum_sources source ON source.id = version.source_id
            LEFT JOIN course_lessons course_lesson ON course_lesson.id = m.course_lesson_id
            LEFT JOIN tvet_lessons tvet_lesson ON tvet_lesson.id = m.tvet_lesson_id
            LEFT JOIN curriculum_units curriculum_unit ON curriculum_unit.id = m.curriculum_unit_id
            LEFT JOIN tvet_units tvet_unit ON tvet_unit.id = m.tvet_unit_id
            LEFT JOIN tvet_modules tvet_module ON tvet_module.id = tvet_unit.module_id
            LEFT JOIN course_modules course_module ON course_module.id = course_lesson.module_id
            LEFT JOIN library_courses course ON course.id = course_module.course_id
            WHERE m.id = $2 AND m.source_type = 'upload' AND m.storage_key IS NOT NULL
                AND m.status = 'published' AND m.processing_status = 'completed'
                AND m.rights_confirmed_at IS NOT NULL
                AND (m.curriculum_version_id IS NULL OR (version.status = 'active' AND source.verification_status = 'verified'))
                AND (m.subject_id IS NULL OR m.tvet_subject_id IS NULL)
                AND m.education_level_id = student.education_level_id
                AND (m.grade_id IS NULL OR m.grade_id = student.grade_id)
                AND (m.program_id IS NULL OR m.program_id = student.program_id)
                AND ((m.subject_id IS NULL AND m.tvet_subject_id IS NULL)
                    OR EXISTS (SELECT 1 FROM student_curriculum_enrollments enrollment
                        JOIN curriculum_subjects enrolled_subject ON enrolled_subject.id = enrollment.curriculum_subject_id
                        WHERE enrollment.student_id = student.id AND enrollment.status = 'active'
                            AND enrolled_subject.id = m.subject_id
                            AND enrolled_subject.education_level_id = student.education_level_id
                            AND (enrolled_subject.grade_id IS NULL OR enrolled_subject.grade_id = student.grade_id)
                            AND (enrolled_subject.program_id IS NULL OR enrolled_subject.program_id = student.program_id)
                            AND (enrolled_subject.combination_id IS NULL OR enrolled_subject.combination_id = student.subject_combination_id))
                    OR EXISTS (SELECT 1 FROM tvet_subjects tvet_subject
                        WHERE tvet_subject.id = m.tvet_subject_id AND tvet_subject.curriculum_version_id = m.curriculum_version_id
                            AND tvet_subject.program_id = student.program_id
                            AND tvet_subject.grade_id = student.grade_id AND tvet_subject.status = 'published'))
                AND (m.course_lesson_id IS NULL OR (course_lesson.status = 'published' AND course_module.status = 'published'
                    AND course.status = 'published' AND course.education_level_id = student.education_level_id
                    AND course.grade_id IS NOT DISTINCT FROM student.grade_id
                    AND course.program_id IS NOT DISTINCT FROM student.program_id))
                AND (m.curriculum_unit_id IS NULL OR curriculum_unit.status = 'published')
                AND (m.tvet_unit_id IS NULL OR EXISTS (
                    SELECT 1 FROM tvet_units unit JOIN tvet_modules module ON module.id = unit.module_id
                        JOIN tvet_competences competence ON competence.id = module.competence_id
                    WHERE unit.id = m.tvet_unit_id AND competence.subject_id = m.tvet_subject_id
                        AND unit.status = 'published' AND module.status = 'published' AND competence.status = 'published'))
                AND (m.tvet_lesson_id IS NULL OR (tvet_lesson.status = 'published'
                    AND EXISTS (SELECT 1 FROM tvet_units unit JOIN tvet_modules module ON module.id = unit.module_id
                        JOIN tvet_competences competence ON competence.id = module.competence_id
                        WHERE unit.id = tvet_lesson.unit_id AND competence.subject_id = m.tvet_subject_id
                            AND unit.status = 'published' AND module.status = 'published' AND competence.status = 'published')))`, [req.auth.userId, materialId]);
        const file = result.rows[0];
        if (!file) return res.status(404).json({ message: "Learning material not found." });
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "private, no-store");
        res.type("application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${String(file.original_filename || "learning-material.pdf").replace(/[\r\n"]/g, "_")}"`);
        return res.sendFile(storagePath(file.storage_key), (error) => {
            if (error && !res.headersSent) res.status(error.statusCode || 404).json({ message: "The learning material could not be loaded." });
        });
    } catch (error) {
        console.error("STUDENT LEARNING MATERIAL DOWNLOAD ERROR:", error);
        return res.status(500).json({ message: "The learning material could not be loaded." });
    }
});

router.get("/subject-note-attachments/:attachmentId", async (req, res) => {
    if (req.auth.role !== "student") return res.status(403).json({ message: "Student access required" });
    const attachmentId = positiveInteger(req.params.attachmentId, "Attachment");
    if (!attachmentId) return res.status(400).json({ message: "A valid attachment is required" });
    try {
        const result = await pool.query(`SELECT a.name, a.mime_type, a.file_data
            FROM subject_note_attachments a
            JOIN subject_notes n ON n.id = a.note_id AND n.status = 'published'
            JOIN users student ON student.id = $1 AND student.role = 'student'
            JOIN admin_schools school ON school.id = student.school_id AND school.status = 'active'
            WHERE a.id = $2
              AND n.school_id = student.school_id
              AND n.education_level_id = student.education_level_id
              AND n.grade_id IS NOT DISTINCT FROM student.grade_id
              AND n.program_id IS NOT DISTINCT FROM student.program_id
              AND EXISTS (
                  SELECT 1 FROM library_courses course
                  WHERE course.subject_id = n.subject_id AND course.status = 'published'
                    AND course.education_level_id = student.education_level_id
                    AND course.grade_id IS NOT DISTINCT FROM student.grade_id
                    AND course.program_id IS NOT DISTINCT FROM student.program_id
              )`, [req.auth.userId, attachmentId]);
        const file = result.rows[0];
        if (!file) return res.status(404).json({ message: "Attachment not found" });
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.type(file.mime_type);
        res.attachment(file.name);
        return res.send(file.file_data);
    } catch (error) {
        console.error("SUBJECT NOTE ATTACHMENT READ ERROR:", error.message);
        return res.status(500).json({ message: "The attachment could not be loaded." });
    }
});

module.exports = router;