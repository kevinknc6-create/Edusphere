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

function requireRole(...roles) {
    return (req, res, next) => roles.includes(req.auth.role) ? next() : res.status(403).json({ message: "You are not authorized to manage course content" });
}

function isAdmin(req) { return ["admin", "super-admin"].includes(req.auth.role); }

async function canEditCourse(courseId, req) {
    if (isAdmin(req)) return true;
    if (req.auth.role !== "teacher") return false;
    const result = await pool.query("SELECT 1 FROM library_courses WHERE id = $1 AND teacher_id = $2", [courseId, req.auth.userId]);
    return Boolean(result.rows[0]);
}

async function canEditLesson(lessonId, req) {
    if (isAdmin(req)) return true;
    if (req.auth.role !== "teacher") return false;
    const result = await pool.query("SELECT 1 FROM course_lessons l JOIN course_modules m ON m.id = l.module_id JOIN library_courses c ON c.id = m.course_id WHERE l.id = $1 AND c.teacher_id = $2", [lessonId, req.auth.userId]);
    return Boolean(result.rows[0]);
}

function integer(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function text(value, fallback = "") {
    return typeof value === "string" ? value.trim() : fallback;
}

router.get("/taxonomy", async (_req, res) => {
    try {
        const [levels, grades, faculties, departments, programs, subjects] = await Promise.all([
            pool.query("SELECT id, code, name, category, position FROM education_levels ORDER BY position, name"),
            pool.query("SELECT id, education_level_id, code, name, position FROM grades ORDER BY education_level_id, position, name"),
            pool.query("SELECT id, name, description FROM faculties ORDER BY name"),
            pool.query("SELECT id, faculty_id, name FROM departments ORDER BY name"),
            pool.query("SELECT p.id, p.department_id, p.name, p.description, COALESCE(array_agg(tpl.grade_id::text) FILTER (WHERE tpl.grade_id IS NOT NULL), ARRAY[]::text[]) AS grade_ids FROM programs p LEFT JOIN tvet_program_levels tpl ON tpl.program_id = p.id GROUP BY p.id ORDER BY p.name"),
            pool.query("SELECT id, name, description, education_level_id, grade_id, program_id FROM library_subjects ORDER BY name"),
        ]);
        res.json({ data: { levels: levels.rows, grades: grades.rows, faculties: faculties.rows, departments: departments.rows, programs: programs.rows, subjects: subjects.rows } });
    } catch (error) {
        console.error("LEARNING TAXONOMY ERROR:", error.message);
        res.status(500).json({ message: "Course library is temporarily unavailable." });
    }
});

router.get("/courses", async (req, res) => {
    const search = text(req.query.search);
    const level = integer(req.query.level);
    const grade = integer(req.query.grade);
    const program = integer(req.query.program);
    const subject = integer(req.query.subject);
    try {
        const result = await pool.query(`
      SELECT c.id, c.title, c.description, c.difficulty, c.status, c.education_level_id, c.grade_id, c.program_id,
             s.name AS subject, u.name AS teacher,
             COUNT(DISTINCT l.id)::int AS lessons
      FROM library_courses c
      JOIN library_subjects s ON s.id = c.subject_id
      LEFT JOIN users u ON u.id = c.teacher_id
      LEFT JOIN course_modules m ON m.course_id = c.id
      LEFT JOIN course_lessons l ON l.module_id = m.id
      WHERE c.status = 'published'
        AND ($1 = '' OR c.title ILIKE $2 OR c.description ILIKE $2 OR s.name ILIKE $2)
        AND ($3::bigint IS NULL OR c.education_level_id = $3)
        AND ($4::bigint IS NULL OR c.grade_id = $4)
        AND ($5::bigint IS NULL OR c.program_id = $5)
        AND ($6::bigint IS NULL OR c.subject_id = $6)
      GROUP BY c.id, s.name, u.name
    ORDER BY c.updated_at DESC, c.title`, [search, `%${search}%`, level, grade, program, subject]);
        res.json({ data: result.rows });
    } catch (error) {
        console.error("COURSE LIST ERROR:", error.message);
        res.status(500).json({ message: "Course library is temporarily unavailable." });
    }
});

router.get("/search", async (req, res) => {
    const query = text(req.query.q);
    if (query.length < 2) return res.status(400).json({ message: "Search must contain at least two characters." });
    try {
        const pattern = `%${query}%`;
        const result = await pool.query(`
      SELECT 'course' AS result_type, c.id, c.title, c.description, s.name AS subject, NULL::bigint AS lesson_id
      FROM library_courses c JOIN library_subjects s ON s.id = c.subject_id
      WHERE c.status = 'published' AND (c.title ILIKE $1 OR c.description ILIKE $1 OR s.name ILIKE $1)
      UNION ALL
      SELECT 'lesson', c.id, l.title, l.explanation, s.name, l.id
      FROM course_lessons l JOIN course_modules m ON m.id = l.module_id JOIN library_courses c ON c.id = m.course_id JOIN library_subjects s ON s.id = c.subject_id
      WHERE c.status = 'published' AND (l.title ILIKE $1 OR l.explanation ILIKE $1 OR l.summary ILIKE $1)
      UNION ALL
      SELECT 'note', c.id, n.title, n.body, s.name, n.lesson_id
      FROM lesson_notes n JOIN course_lessons l ON l.id = n.lesson_id JOIN course_modules m ON m.id = l.module_id JOIN library_courses c ON c.id = m.course_id JOIN library_subjects s ON s.id = c.subject_id
      WHERE c.status = 'published' AND (n.title ILIKE $1 OR n.body ILIKE $1)
      UNION ALL
      SELECT 'example', c.id, e.title, e.body, s.name, e.lesson_id
      FROM lesson_examples e JOIN course_lessons l ON l.id = e.lesson_id JOIN course_modules m ON m.id = l.module_id JOIN library_courses c ON c.id = m.course_id JOIN library_subjects s ON s.id = c.subject_id
      WHERE c.status = 'published' AND (e.title ILIKE $1 OR e.body ILIKE $1)
      UNION ALL
      SELECT 'exercise', c.id, 'Practice exercise', x.prompt, s.name, x.lesson_id
      FROM lesson_exercises x JOIN course_lessons l ON l.id = x.lesson_id JOIN course_modules m ON m.id = l.module_id JOIN library_courses c ON c.id = m.course_id JOIN library_subjects s ON s.id = c.subject_id
      WHERE c.status = 'published' AND x.prompt ILIKE $1
      ORDER BY title LIMIT 100`, [pattern]);
        res.json({ data: result.rows });
    } catch (error) {
        console.error("COURSE SEARCH ERROR:", error.message);
        res.status(500).json({ message: "Search is temporarily unavailable." });
    }
});

router.get("/courses/:id", async (req, res) => {
    const courseId = integer(req.params.id);
    if (!courseId) return res.status(400).json({ message: "Invalid course id" });
    try {
        const course = await pool.query(`SELECT c.*, s.name AS subject, u.name AS teacher FROM library_courses c JOIN library_subjects s ON s.id = c.subject_id LEFT JOIN users u ON u.id = c.teacher_id WHERE c.id = $1 AND c.status = 'published'`, [courseId]);
        if (!course.rows[0]) return res.status(404).json({ message: "Course not found" });
        const modules = await pool.query(`SELECT m.id, m.title, m.position, COALESCE(json_agg(json_build_object('id', l.id, 'title', l.title, 'explanation', l.explanation, 'keyPoints', l.key_points, 'definitions', l.definitions, 'summary', l.summary, 'position', l.position, 'notes', (SELECT COALESCE(json_agg(n ORDER BY n.position), '[]') FROM lesson_notes n WHERE n.lesson_id = l.id), 'examples', (SELECT COALESCE(json_agg(e ORDER BY e.position), '[]') FROM lesson_examples e WHERE e.lesson_id = l.id), 'exercises', (SELECT COALESCE(json_agg(x ORDER BY x.position), '[]') FROM lesson_exercises x WHERE x.lesson_id = l.id)) ORDER BY l.position) FILTER (WHERE l.id IS NOT NULL), '[]') AS lessons FROM course_modules m LEFT JOIN course_lessons l ON l.module_id = m.id WHERE m.course_id = $1 GROUP BY m.id ORDER BY m.position`, [courseId]);
        res.json({ data: { ...course.rows[0], modules: modules.rows } });
    } catch (error) {
        console.error("COURSE DETAIL ERROR:", error.message);
        res.status(500).json({ message: "Course details are temporarily unavailable." });
    }
});

router.use(requireAuth);

router.get("/me/progress", async (req, res) => {
    try {
        const result = await pool.query(`SELECT c.id AS course_id, c.title, COUNT(l.id)::int AS total_lessons, COUNT(lp.lesson_id) FILTER (WHERE lp.completed_at IS NOT NULL)::int AS completed_lessons, COALESCE(ROUND(COUNT(lp.lesson_id) FILTER (WHERE lp.completed_at IS NOT NULL) * 100.0 / NULLIF(COUNT(l.id), 0)), 0)::int AS progress FROM library_enrollments e JOIN library_courses c ON c.id = e.course_id LEFT JOIN course_modules m ON m.course_id = c.id LEFT JOIN course_lessons l ON l.module_id = m.id LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.student_id = $1 WHERE e.student_id = $1 GROUP BY c.id, c.title ORDER BY MAX(lp.completed_at) DESC NULLS LAST`, [req.auth.userId]);
        res.json({ data: result.rows });
    } catch (error) {
        console.error("PROGRESS ERROR:", error.message);
        res.status(500).json({ message: "Progress is temporarily unavailable." });
    }
});

router.post("/courses/:id/enroll", async (req, res) => {
    const courseId = integer(req.params.id);
    if (!courseId) return res.status(400).json({ message: "Invalid course id" });
    await pool.query("INSERT INTO library_enrollments (student_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [req.auth.userId, courseId]);
    res.status(201).json({ message: "Enrolled" });
});

router.post("/lessons/:id/progress", async (req, res) => {
    const lessonId = integer(req.params.id);
    const secondsSpent = Number(req.body.secondsSpent || 0);
    if (!lessonId || !Number.isInteger(secondsSpent) || secondsSpent < 0 || secondsSpent > 86400) return res.status(400).json({ message: "Invalid lesson progress" });
    const lesson = await pool.query("SELECT m.course_id FROM course_lessons l JOIN course_modules m ON m.id = l.module_id WHERE l.id = $1", [lessonId]);
    if (!lesson.rows[0]) return res.status(404).json({ message: "Lesson not found" });
    await pool.query(`INSERT INTO lesson_progress (student_id, course_id, lesson_id, completed_at, seconds_spent) VALUES ($1, $2, $3, CASE WHEN $4 THEN now() ELSE NULL END, $5) ON CONFLICT (student_id, lesson_id) DO UPDATE SET completed_at = EXCLUDED.completed_at, seconds_spent = lesson_progress.seconds_spent + EXCLUDED.seconds_spent`, [req.auth.userId, lesson.rows[0].course_id, lessonId, Boolean(req.body.completed), secondsSpent]);
    await pool.query("INSERT INTO recently_viewed_lessons (student_id, lesson_id) VALUES ($1, $2) ON CONFLICT (student_id, lesson_id) DO UPDATE SET viewed_at = now()", [req.auth.userId, lessonId]);
    res.json({ message: "Progress saved" });
});

router.put("/lessons/:id/bookmark", async (req, res) => {
    const lessonId = integer(req.params.id);
    if (!lessonId) return res.status(400).json({ message: "Invalid lesson id" });
    if (req.body.bookmarked === false) await pool.query("DELETE FROM library_bookmarks WHERE student_id = $1 AND lesson_id = $2", [req.auth.userId, lessonId]);
    else await pool.query("INSERT INTO library_bookmarks (student_id, lesson_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [req.auth.userId, lessonId]);
    res.status(204).send();
});

router.post("/admin/subjects", requireRole("teacher", "admin", "super-admin"), async (req, res) => {
    const name = text(req.body.name);
    if (!name) return res.status(400).json({ message: "Subject name is required" });
    const result = await pool.query("INSERT INTO library_subjects (name, description, education_level_id, grade_id, program_id, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *", [name, text(req.body.description), integer(req.body.educationLevelId), integer(req.body.gradeId), integer(req.body.programId), req.auth.userId]);
    res.status(201).json({ data: result.rows[0] });
});

router.post("/admin/courses", requireRole("teacher", "admin", "super-admin"), async (req, res) => {
    const title = text(req.body.title);
    const subjectId = integer(req.body.subjectId);
    if (!title || !subjectId) return res.status(400).json({ message: "Course title and subject are required" });
    const result = await pool.query("INSERT INTO library_courses (subject_id, program_id, education_level_id, grade_id, teacher_id, title, description, difficulty, learning_objectives, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft') RETURNING *", [subjectId, integer(req.body.programId), integer(req.body.educationLevelId), integer(req.body.gradeId), req.auth.userId, title, text(req.body.description), text(req.body.difficulty, "Beginner"), JSON.stringify(Array.isArray(req.body.learningObjectives) ? req.body.learningObjectives : [])]);
    res.status(201).json({ data: result.rows[0] });
});

router.post("/admin/levels", requireRole("admin", "super-admin"), async (req, res) => {
    const name = text(req.body.name); const code = text(req.body.code).toUpperCase(); const category = text(req.body.category, "CUSTOM");
    if (!name || !code) return res.status(400).json({ message: "Level name and code are required" });
    const result = await pool.query("INSERT INTO education_levels (name, code, category, position) VALUES ($1, $2, $3, $4) RETURNING *", [name, code, category, Number(req.body.position) || 0]);
    res.status(201).json({ data: result.rows[0] });
});

router.post("/admin/grades", requireRole("admin", "super-admin"), async (req, res) => {
    const levelId = integer(req.body.educationLevelId); const name = text(req.body.name); const code = text(req.body.code).toUpperCase();
    if (!levelId || !name || !code) return res.status(400).json({ message: "Education level, grade name, and code are required" });
    const result = await pool.query("INSERT INTO grades (education_level_id, name, code, position) VALUES ($1, $2, $3, $4) RETURNING *", [levelId, name, code, Number(req.body.position) || 0]);
    res.status(201).json({ data: result.rows[0] });
});

router.post("/admin/faculties", requireRole("admin", "super-admin"), async (req, res) => {
    const name = text(req.body.name); if (!name) return res.status(400).json({ message: "Faculty name is required" });
    const result = await pool.query("INSERT INTO faculties (name, description) VALUES ($1, $2) RETURNING *", [name, text(req.body.description)]); res.status(201).json({ data: result.rows[0] });
});

router.post("/admin/departments", requireRole("admin", "super-admin"), async (req, res) => {
    const facultyId = integer(req.body.facultyId); const name = text(req.body.name); if (!facultyId || !name) return res.status(400).json({ message: "Faculty and department name are required" });
    const result = await pool.query("INSERT INTO departments (faculty_id, name) VALUES ($1, $2) RETURNING *", [facultyId, name]); res.status(201).json({ data: result.rows[0] });
});

router.post("/admin/programs", requireRole("admin", "super-admin"), async (req, res) => {
    const name = text(req.body.name); if (!name) return res.status(400).json({ message: "Program name is required" });
    const result = await pool.query("INSERT INTO programs (department_id, name, description) VALUES ($1, $2, $3) RETURNING *", [integer(req.body.departmentId), name, text(req.body.description)]); res.status(201).json({ data: result.rows[0] });
});

router.post("/admin/university/programs", requireRole("teacher", "admin", "super-admin"), async (req, res) => {
    const programId = integer(req.body.programId); if (!programId) return res.status(400).json({ message: "Program is required" });
    const result = await pool.query(`INSERT INTO university_programs (program_id, faculty_id, department_id, award, description, source_reference, status) VALUES ($1, $2, $3, $4, $5, $6, 'draft') ON CONFLICT (program_id) DO UPDATE SET faculty_id = EXCLUDED.faculty_id, department_id = EXCLUDED.department_id, award = EXCLUDED.award, description = EXCLUDED.description, source_reference = EXCLUDED.source_reference RETURNING *`, [programId, integer(req.body.facultyId), integer(req.body.departmentId), text(req.body.award), text(req.body.description), text(req.body.sourceReference)]);
    res.status(201).json({ data: result.rows[0] });
});

router.post("/admin/university/years", requireRole("teacher", "admin", "super-admin"), async (req, res) => {
    const programId = integer(req.body.programId); const yearNumber = Number(req.body.yearNumber); if (!programId || !Number.isInteger(yearNumber) || yearNumber < 1) return res.status(400).json({ message: "Program and valid year are required" });
    const result = await pool.query("INSERT INTO university_years (program_id, year_number, title) VALUES ($1, $2, $3) ON CONFLICT (program_id, year_number) DO UPDATE SET title = EXCLUDED.title RETURNING *", [programId, yearNumber, text(req.body.title)]); res.status(201).json({ data: result.rows[0] });
});

router.post("/admin/university/semesters", requireRole("teacher", "admin", "super-admin"), async (req, res) => {
    const yearId = integer(req.body.yearId); const semesterNumber = Number(req.body.semesterNumber); if (!yearId || !Number.isInteger(semesterNumber) || semesterNumber < 1) return res.status(400).json({ message: "Year and valid semester are required" });
    const result = await pool.query("INSERT INTO university_semesters (year_id, semester_number, title) VALUES ($1, $2, $3) ON CONFLICT (year_id, semester_number) DO UPDATE SET title = EXCLUDED.title RETURNING *", [yearId, semesterNumber, text(req.body.title)]); res.status(201).json({ data: result.rows[0] });
});

router.post("/admin/university/offerings", requireRole("teacher", "admin", "super-admin"), async (req, res) => {
    const courseId = integer(req.body.courseId); const programId = integer(req.body.programId); if (!courseId || !programId) return res.status(400).json({ message: "Course and program are required" });
    const result = await pool.query("INSERT INTO university_course_offerings (course_id, program_id, year_id, semester_id, course_code, credits) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (course_id, program_id) DO UPDATE SET year_id = EXCLUDED.year_id, semester_id = EXCLUDED.semester_id, course_code = EXCLUDED.course_code, credits = EXCLUDED.credits RETURNING *", [courseId, programId, integer(req.body.yearId), integer(req.body.semesterId), text(req.body.courseCode), req.body.credits === undefined ? null : Number(req.body.credits)]); res.status(201).json({ data: result.rows[0] });
});

router.post("/courses/:id/modules", requireAuth, async (req, res) => {
    const courseId = integer(req.params.id); if (!courseId || !(await canEditCourse(courseId, req))) return res.status(403).json({ message: "Course editing is not authorized" });
    const title = text(req.body.title); if (!title) return res.status(400).json({ message: "Module title is required" });
    const result = await pool.query("INSERT INTO course_modules (course_id, title, position) VALUES ($1, $2, $3) RETURNING *", [courseId, title, Number(req.body.position) || 1]); res.status(201).json({ data: result.rows[0] });
});

router.post("/modules/:id/lessons", requireAuth, async (req, res) => {
    const moduleId = integer(req.params.id); const module = await pool.query("SELECT course_id FROM course_modules WHERE id = $1", [moduleId]);
    if (!module.rows[0] || !(await canEditCourse(module.rows[0].course_id, req))) return res.status(403).json({ message: "Lesson editing is not authorized" });
    const title = text(req.body.title); if (!title) return res.status(400).json({ message: "Lesson title is required" });
    const result = await pool.query("INSERT INTO course_lessons (module_id, title, explanation, key_points, definitions, summary, position, language) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *", [moduleId, title, text(req.body.explanation), JSON.stringify(Array.isArray(req.body.keyPoints) ? req.body.keyPoints : []), JSON.stringify(Array.isArray(req.body.definitions) ? req.body.definitions : []), text(req.body.summary), Number(req.body.position) || 1, text(req.body.language, "English")]);
    res.status(201).json({ data: result.rows[0] });
});

router.patch("/lessons/:id", requireAuth, async (req, res) => {
    const lessonId = integer(req.params.id); if (!lessonId || !(await canEditLesson(lessonId, req))) return res.status(403).json({ message: "Lesson editing is not authorized" });
    const result = await pool.query("UPDATE course_lessons SET title = COALESCE(NULLIF($1, ''), title), explanation = COALESCE($2, explanation), key_points = COALESCE($3, key_points), definitions = COALESCE($4, definitions), summary = COALESCE($5, summary) WHERE id = $6 RETURNING *", [text(req.body.title), req.body.explanation, req.body.keyPoints ? JSON.stringify(req.body.keyPoints) : null, req.body.definitions ? JSON.stringify(req.body.definitions) : null, req.body.summary, lessonId]);
    res.json({ data: result.rows[0] });
});

router.post("/lessons/:id/notes", requireAuth, async (req, res) => {
    const lessonId = integer(req.params.id); if (!lessonId || !(await canEditLesson(lessonId, req))) return res.status(403).json({ message: "Lesson editing is not authorized" });
    const body = text(req.body.body); if (!body) return res.status(400).json({ message: "Note content is required" });
    const result = await pool.query("INSERT INTO lesson_notes (lesson_id, title, body, position) VALUES ($1, $2, $3, $4) RETURNING *", [lessonId, text(req.body.title, "Notes"), body, Number(req.body.position) || 0]); res.status(201).json({ data: result.rows[0] });
});

router.post("/lessons/:id/examples", requireAuth, async (req, res) => {
    const lessonId = integer(req.params.id); if (!lessonId || !(await canEditLesson(lessonId, req))) return res.status(403).json({ message: "Lesson editing is not authorized" });
    const body = text(req.body.body); if (!body) return res.status(400).json({ message: "Example content is required" });
    const result = await pool.query("INSERT INTO lesson_examples (lesson_id, title, body, position) VALUES ($1, $2, $3, $4) RETURNING *", [lessonId, text(req.body.title, "Example"), body, Number(req.body.position) || 0]); res.status(201).json({ data: result.rows[0] });
});

router.post("/lessons/:id/exercises", requireAuth, async (req, res) => {
    const lessonId = integer(req.params.id); if (!lessonId || !(await canEditLesson(lessonId, req))) return res.status(403).json({ message: "Lesson editing is not authorized" });
    const prompt = text(req.body.prompt); if (!prompt) return res.status(400).json({ message: "Exercise prompt is required" });
    const result = await pool.query("INSERT INTO lesson_exercises (lesson_id, prompt, answer, position) VALUES ($1, $2, $3, $4) RETURNING *", [lessonId, prompt, text(req.body.answer) || null, Number(req.body.position) || 0]); res.status(201).json({ data: result.rows[0] });
});

router.post("/courses/:id/quizzes", requireAuth, async (req, res) => {
    const courseId = integer(req.params.id); if (!courseId || !(await canEditCourse(courseId, req))) return res.status(403).json({ message: "Quiz editing is not authorized" });
    const title = text(req.body.title); if (!title) return res.status(400).json({ message: "Quiz title is required" });
    const result = await pool.query("INSERT INTO library_quizzes (course_id, lesson_id, title, published) VALUES ($1, $2, $3, false) RETURNING *", [courseId, integer(req.body.lessonId), title]); res.status(201).json({ data: result.rows[0] });
});

router.post("/quizzes/:id/questions", requireAuth, async (req, res) => {
    const quizId = integer(req.params.id); const quiz = await pool.query("SELECT course_id FROM library_quizzes WHERE id = $1", [quizId]);
    if (!quiz.rows[0] || !(await canEditCourse(quiz.rows[0].course_id, req))) return res.status(403).json({ message: "Quiz editing is not authorized" });
    const prompt = text(req.body.prompt); if (!prompt) return res.status(400).json({ message: "Question prompt is required" });
    const result = await pool.query("INSERT INTO quiz_questions (quiz_id, question_type, prompt, options, correct_answer, explanation, position) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *", [quizId, text(req.body.questionType, "multiple-choice"), prompt, JSON.stringify(Array.isArray(req.body.options) ? req.body.options : []), text(req.body.correctAnswer) || null, text(req.body.explanation), Number(req.body.position) || 0]); res.status(201).json({ data: result.rows[0] });
});

router.post("/quizzes/:id/attempts", requireAuth, async (req, res) => {
    const quizId = integer(req.params.id); if (!quizId) return res.status(400).json({ message: "Invalid quiz id" });
    const result = await pool.query("INSERT INTO library_quiz_attempts (student_id, quiz_id, answers) VALUES ($1, $2, $3) RETURNING id, score, submitted_at", [req.auth.userId, quizId, JSON.stringify(req.body.answers || {})]); res.status(201).json({ data: result.rows[0] });
});

router.patch("/courses/:id/status", requireAuth, async (req, res) => {
    const courseId = integer(req.params.id); const allowed = ["draft", "pending", "published", "archived"];
    if (!courseId || !allowed.includes(req.body.status) || !(await canEditCourse(courseId, req))) return res.status(403).json({ message: "Course publishing is not authorized" });
    const result = await pool.query("UPDATE library_courses SET status = $1, updated_at = now() WHERE id = $2 RETURNING id, title, status", [req.body.status, courseId]); res.json({ data: result.rows[0] });
});

module.exports = router;