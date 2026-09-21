const express = require("express");
const jwt = require("jsonwebtoken");
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

router.get("/me/education-profile", async (req, res) => {
    try {
        const result = await pool.query(`
      SELECT u.education_level_id, u.grade_id, u.program_id,
             el.name AS education_level_name, g.name AS grade_name, p.name AS program_name
      FROM users u
      LEFT JOIN education_levels el ON el.id = u.education_level_id
      LEFT JOIN grades g ON g.id = u.grade_id
      LEFT JOIN programs p ON p.id = u.program_id
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
            SELECT u.education_level_id, u.grade_id, u.program_id,
                         el.name AS education_level_name, g.name AS grade_name, p.name AS program_name
            FROM users u
            LEFT JOIN education_levels el ON el.id = u.education_level_id
            LEFT JOIN grades g ON g.id = u.grade_id
            LEFT JOIN programs p ON p.id = u.program_id
            WHERE u.id = $1`, [req.auth.userId]);
        const profile = profileResult.rows[0] || null;
        if (!profile) return res.status(404).json({ message: "User account not found" });

        const [curriculum, subjects, courses, notes, exercises, quizzes, progress] = await Promise.all([
            pool.query(`
                SELECT cs.id, cs.code, cs.name, cs.description, cs.source_reference,
                             cv.version_label, cv.effective_from, csrc.authority, csrc.title AS source_title, csrc.url AS source_url
                FROM curriculum_subjects cs
                JOIN curriculum_versions cv ON cv.id = cs.curriculum_version_id AND cv.status = 'active'
                JOIN curriculum_sources csrc ON csrc.id = cv.source_id
                WHERE cs.education_level_id = $1
                    AND ($2::bigint IS NULL OR cs.grade_id = $2 OR cs.grade_id IS NULL)
                    AND ($3::bigint IS NULL OR cs.program_id = $3 OR cs.program_id IS NULL)
                ORDER BY cs.name`, [profile.education_level_id, profile.grade_id, profile.program_id]),
            pool.query(`
                SELECT DISTINCT s.id, s.name, s.description
                FROM library_subjects s
                WHERE s.education_level_id = $1 AND s.grade_id = $2 AND s.program_id IS NULL
                ORDER BY s.name`, [profile.education_level_id, profile.grade_id, profile.program_id]),
            pool.query(`
                SELECT c.id, c.title, c.description, c.difficulty, c.status,
                             c.education_level_id, c.grade_id, c.program_id,
                             s.name AS subject, u.name AS teacher,
                             COUNT(DISTINCT l.id)::int AS lessons
                FROM library_courses c
                JOIN library_subjects s ON s.id = c.subject_id
                LEFT JOIN users u ON u.id = c.teacher_id
                LEFT JOIN course_modules m ON m.course_id = c.id
                LEFT JOIN course_lessons l ON l.module_id = m.id
                WHERE c.status = 'published' AND c.education_level_id = $1 AND c.grade_id = $2 AND c.program_id IS NULL
                GROUP BY c.id, s.name, u.name
                ORDER BY c.updated_at DESC, c.title`, [profile.education_level_id, profile.grade_id, profile.program_id]),
            pool.query(`
                SELECT n.id, n.title, n.body, n.lesson_id, c.title AS course_title
                FROM lesson_notes n
                JOIN course_lessons l ON l.id = n.lesson_id
                JOIN course_modules m ON m.id = l.module_id
                JOIN library_courses c ON c.id = m.course_id
                WHERE c.status = 'published' AND c.education_level_id = $1 AND c.grade_id = $2 AND c.program_id IS NULL
                ORDER BY n.position, n.id`, [profile.education_level_id, profile.grade_id, profile.program_id]),
            pool.query(`
                SELECT x.id, x.prompt, x.answer, x.lesson_id, c.title AS course_title
                FROM lesson_exercises x
                JOIN course_lessons l ON l.id = x.lesson_id
                JOIN course_modules m ON m.id = l.module_id
                JOIN library_courses c ON c.id = m.course_id
                WHERE c.status = 'published' AND c.education_level_id = $1 AND c.grade_id = $2 AND c.program_id IS NULL
                ORDER BY x.position, x.id`, [profile.education_level_id, profile.grade_id, profile.program_id]),
            pool.query(`
                SELECT q.id, q.title, q.course_id, c.title AS course_title, q.lesson_id
                FROM library_quizzes q
                JOIN library_courses c ON c.id = q.course_id
                WHERE c.status = 'published' AND c.education_level_id = $1 AND c.grade_id = $2 AND c.program_id IS NULL
                ORDER BY q.id`, [profile.education_level_id, profile.grade_id, profile.program_id]),
            pool.query(`
                SELECT e.course_id, c.title AS course_title, COUNT(DISTINCT l.id)::int AS total_lessons,
                             COUNT(lp.lesson_id) FILTER (WHERE lp.completed_at IS NOT NULL)::int AS completed_lessons
                FROM library_enrollments e
                JOIN library_courses c ON c.id = e.course_id
                LEFT JOIN course_modules m ON m.course_id = c.id
                LEFT JOIN course_lessons l ON l.module_id = m.id
                LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.student_id = e.student_id
                WHERE e.student_id = $1
                GROUP BY e.course_id, c.title`, [req.auth.userId]),
        ]);
        res.json({ data: { profile, curriculum: curriculum.rows, subjects: subjects.rows, courses: courses.rows, notes: notes.rows, exercises: exercises.rows, quizzes: quizzes.rows, tests: [], exams: [], homework: [], results: [], progress: progress.rows } });
    } catch (error) {
        console.error("LEARNING DASHBOARD ERROR:", error.message);
        res.status(500).json({ message: "Learning dashboard is temporarily unavailable." });
    }
});

router.get("/me/tvet-dashboard", async (req, res) => {
    try {
        const profileResult = await pool.query(`
      SELECT u.education_level_id, u.grade_id, u.program_id,
             el.name AS education_level_name, g.name AS grade_name, p.name AS program_name
      FROM users u
      LEFT JOIN education_levels el ON el.id = u.education_level_id
      LEFT JOIN grades g ON g.id = u.grade_id
      LEFT JOIN programs p ON p.id = u.program_id
      WHERE u.id = $1`, [req.auth.userId]);
        const profile = profileResult.rows[0] || null;
        if (!profile?.program_id || !profile.grade_id) return res.status(400).json({ message: "Select a TVET level and program first" });

        const [subjects, competences, modules, units, lessons, practicals, assessments] = await Promise.all([
            pool.query("SELECT id, code, name, description, source_reference FROM tvet_subjects WHERE program_id = $1 AND grade_id = $2 AND status = 'published' ORDER BY name", [profile.program_id, profile.grade_id]),
            pool.query("SELECT c.id, c.subject_id, c.code, c.title, c.description, c.position FROM tvet_competences c JOIN tvet_subjects s ON s.id = c.subject_id WHERE s.program_id = $1 AND s.grade_id = $2 AND s.status = 'published' AND c.status = 'published' ORDER BY c.position, c.title", [profile.program_id, profile.grade_id]),
            pool.query("SELECT m.id, m.competence_id, m.title, m.description, m.position FROM tvet_modules m JOIN tvet_competences c ON c.id = m.competence_id JOIN tvet_subjects s ON s.id = c.subject_id WHERE s.program_id = $1 AND s.grade_id = $2 AND s.status = 'published' AND c.status = 'published' AND m.status = 'published' ORDER BY m.position, m.title", [profile.program_id, profile.grade_id]),
            pool.query("SELECT u.id, u.module_id, u.title, u.description, u.position FROM tvet_units u JOIN tvet_modules m ON m.id = u.module_id JOIN tvet_competences c ON c.id = m.competence_id JOIN tvet_subjects s ON s.id = c.subject_id WHERE s.program_id = $1 AND s.grade_id = $2 AND s.status = 'published' AND c.status = 'published' AND m.status = 'published' AND u.status = 'published' ORDER BY u.position, u.title", [profile.program_id, profile.grade_id]),
            pool.query("SELECT l.id, l.unit_id, l.title, l.content, l.duration_minutes, l.position FROM tvet_lessons l JOIN tvet_units u ON u.id = l.unit_id JOIN tvet_modules m ON m.id = u.module_id JOIN tvet_competences c ON c.id = m.competence_id JOIN tvet_subjects s ON s.id = c.subject_id WHERE s.program_id = $1 AND s.grade_id = $2 AND s.status = 'published' AND c.status = 'published' AND m.status = 'published' AND u.status = 'published' AND l.status = 'published' ORDER BY l.position, l.title", [profile.program_id, profile.grade_id]),
            pool.query("SELECT p.id, p.lesson_id, p.title, p.instructions, p.resources, p.position FROM tvet_practical_exercises p JOIN tvet_lessons l ON l.id = p.lesson_id JOIN tvet_units u ON u.id = l.unit_id JOIN tvet_modules m ON m.id = u.module_id JOIN tvet_competences c ON c.id = m.competence_id JOIN tvet_subjects s ON s.id = c.subject_id WHERE s.program_id = $1 AND s.grade_id = $2 AND s.status = 'published' AND c.status = 'published' AND m.status = 'published' AND u.status = 'published' AND l.status = 'published' ORDER BY p.position, p.title", [profile.program_id, profile.grade_id]),
            pool.query("SELECT id, type, title, instructions, time_limit_seconds, lesson_id FROM tvet_assessments WHERE program_id = $1 AND grade_id = $2 AND status = 'published' ORDER BY type, title", [profile.program_id, profile.grade_id]),
        ]);
        res.json({ data: { profile, subjects: subjects.rows, competences: competences.rows, modules: modules.rows, units: units.rows, lessons: lessons.rows, practicalExercises: practicals.rows, assessments: assessments.rows, notes: [], exercises: [], quizzes: assessments.rows.filter((item) => item.type === 'quiz'), tests: assessments.rows.filter((item) => item.type === 'test'), exams: assessments.rows.filter((item) => item.type === 'exam'), assignments: [], results: [], progress: [] } });
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
    try {
        const result = await pool.query("UPDATE users SET education_level_id = NULL, grade_id = NULL, program_id = NULL WHERE id = $1 RETURNING id", [req.auth.userId]);
        if (!result.rows[0]) return res.status(404).json({ message: "User account not found" });
        res.status(204).send();
    } catch (error) {
        console.error("EDUCATION PROFILE RESET ERROR:", error.message);
        res.status(500).json({ message: "Learning path could not be reset." });
    }
});

router.patch("/me/education-profile", async (req, res) => {
    const educationLevelId = positiveInteger(req.body.educationLevelId, "educationLevelId");
    const gradeId = positiveInteger(req.body.gradeId, "gradeId", true);
    const programId = positiveInteger(req.body.programId, "programId", true);
    const validationError = [educationLevelId, gradeId, programId].find((value) => value && value.error);
    if (validationError) return res.status(400).json({ message: validationError.error });

    try {
        const level = await pool.query("SELECT id, name FROM education_levels WHERE id = $1", [educationLevelId]);
        if (!level.rows[0]) return res.status(400).json({ message: "The selected education level is not available" });

        if (gradeId !== null) {
            const grade = await pool.query("SELECT id FROM grades WHERE id = $1 AND education_level_id = $2", [gradeId, educationLevelId]);
            if (!grade.rows[0]) return res.status(400).json({ message: "The selected grade does not belong to that education level" });
        }

        if (programId !== null) {
            const program = await pool.query(`
        SELECT p.id
        FROM programs p
        LEFT JOIN tvet_program_levels tpl ON tpl.program_id = p.id
        WHERE p.id = $1
          AND ($2::bigint IS NULL OR tpl.grade_id = $2 OR NOT EXISTS (SELECT 1 FROM tvet_program_levels WHERE program_id = p.id))`, [programId, gradeId]);
            if (!program.rows[0]) return res.status(400).json({ message: "The selected program is not available" });
        }

        const result = await pool.query(`
      UPDATE users
      SET education_level_id = $1,
          grade_id = $2,
          program_id = $3
      WHERE id = $4
      RETURNING education_level_id, grade_id, program_id`, [educationLevelId, gradeId, programId, req.auth.userId]);
        if (!result.rows[0]) return res.status(404).json({ message: "User account not found" });
        res.json({ data: result.rows[0] });
    } catch (error) {
        console.error("EDUCATION PROFILE UPDATE ERROR:", error.message);
        res.status(500).json({ message: "Education profile could not be saved." });
    }
});

module.exports = router;