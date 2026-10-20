const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();
const contentTypes = new Set(["levels", "grades", "programs", "subjects", "courses", "modules", "lessons", "notes", "examples", "exercises", "assignments", "quizzes", "tests", "exams"]);

function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
function positiveInteger(value, label) { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) throw httpError(400, `${label} must be a positive integer.`); return parsed; }
function optionalInteger(value) { if (value === null || value === undefined || value === "") return null; return positiveInteger(value, "ID"); }
function text(value, label, required = false, max = 4000) {
    const result = typeof value === "string" ? value.trim() : "";
    if (required && !result) throw httpError(400, `${label} is required.`);
    if (result.length > max) throw httpError(400, `${label} is too long.`);
    return result;
}
function statusValue(value, fallback = "draft") {
    const result = value || fallback;
    if (!["draft", "pending", "published", "rejected", "archived"].includes(result)) throw httpError(400, "Invalid content status.");
    return result;
}

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

async function requireAdmin(req, res, next) {
    try {
        const result = await pool.query("SELECT role, status FROM users WHERE id = $1", [req.auth.userId]);
        const user = result.rows[0];
        if (!user || user.status !== "active") return res.status(401).json({ message: "Active administrator session required" });
        if (!["admin", "super-admin"].includes(user.role)) return res.status(403).json({ message: "Admin access required" });
        req.auth.role = user.role;
        next();
    } catch (error) {
        console.error("ADMIN AUTH ERROR:", error);
        res.status(500).json({ message: "Administrator access could not be verified" });
    }
}

router.use(requireAuth, requireAdmin);

async function audit(req, action, type, id, metadata = {}) {
    await pool.query("INSERT INTO admin_audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5)", [req.auth.userId, action, type, id === null ? null : String(id), JSON.stringify(metadata)]);
}

async function targetFrom(body, requireSubject = true) {
    const educationLevelId = positiveInteger(body.educationLevelId, "Education level");
    const gradeId = positiveInteger(body.gradeId, "Class/grade");
    const programId = optionalInteger(body.programId);
    const subjectId = requireSubject ? positiveInteger(body.subjectId, "Subject") : optionalInteger(body.subjectId);
    const [level, grade] = await Promise.all([
        pool.query("SELECT id FROM education_levels WHERE id = $1", [educationLevelId]),
        pool.query("SELECT id FROM grades WHERE id = $1 AND education_level_id = $2", [gradeId, educationLevelId]),
    ]);
    if (!level.rows[0] || !grade.rows[0]) throw httpError(400, "Choose a class that belongs to the selected education level.");
    if (programId) {
        const program = await pool.query("SELECT id FROM programs WHERE id = $1", [programId]);
        if (!program.rows[0]) throw httpError(400, "The selected program does not exist.");
        const programGrades = await pool.query("SELECT 1 FROM tvet_program_levels WHERE program_id = $1 LIMIT 1", [programId]);
        if (programGrades.rows[0]) {
            const assignment = await pool.query("SELECT 1 FROM tvet_program_levels WHERE program_id = $1 AND grade_id = $2", [programId, gradeId]);
            if (!assignment.rows[0]) throw httpError(400, "The selected program is not assigned to this class.");
        }
    }
    if (subjectId) {
        const subject = await pool.query("SELECT id FROM library_subjects WHERE id = $1 AND education_level_id = $2 AND grade_id IS NOT DISTINCT FROM $3::bigint AND program_id IS NOT DISTINCT FROM $4::bigint", [subjectId, educationLevelId, gradeId, programId]);
        if (!subject.rows[0]) throw httpError(400, "The subject is not assigned to this exact class and program.");
    }
    return { educationLevelId, gradeId, programId, subjectId };
}

async function ownedCourseFor(type, id) {
    const queries = {
        courses: "SELECT id AS course_id FROM library_courses WHERE id = $1",
        modules: "SELECT course_id FROM course_modules WHERE id = $1",
        lessons: "SELECT m.course_id FROM course_lessons l JOIN course_modules m ON m.id = l.module_id WHERE l.id = $1",
        notes: "SELECT m.course_id FROM lesson_notes x JOIN course_lessons l ON l.id = x.lesson_id JOIN course_modules m ON m.id = l.module_id WHERE x.id = $1",
        examples: "SELECT m.course_id FROM lesson_examples x JOIN course_lessons l ON l.id = x.lesson_id JOIN course_modules m ON m.id = l.module_id WHERE x.id = $1",
        exercises: "SELECT m.course_id FROM lesson_exercises x JOIN course_lessons l ON l.id = x.lesson_id JOIN course_modules m ON m.id = l.module_id WHERE x.id = $1",
        assignments: "SELECT course_id FROM library_assessments WHERE id = $1 AND kind = 'homework'",
        tests: "SELECT course_id FROM library_assessments WHERE id = $1 AND kind = 'test'",
        exams: "SELECT course_id FROM library_assessments WHERE id = $1 AND kind = 'exam'",
        quizzes: "SELECT course_id FROM library_quizzes WHERE id = $1",
    };
    const result = await pool.query(queries[type], [id]);
    if (!result.rows[0]) throw httpError(404, "Content not found.");
    return result.rows[0].course_id;
}

async function assertCourseTarget(courseId, target) {
    const result = await pool.query("SELECT id FROM library_courses WHERE id = $1 AND education_level_id = $2 AND grade_id IS NOT DISTINCT FROM $3::bigint AND program_id IS NOT DISTINCT FROM $4::bigint AND ($5::bigint IS NULL OR subject_id = $5)", [courseId, target.educationLevelId, target.gradeId, target.programId, target.subjectId]);
    if (!result.rows[0]) throw httpError(400, "The selected content does not match this education level, class, program, and subject.");
}

const listQueries = {
    levels: "SELECT id, code, name, category, position, id AS value FROM education_levels WHERE ($1::text IS NULL OR name ILIKE $2 OR code ILIKE $2) ORDER BY position, name",
    grades: "SELECT g.id, g.education_level_id, g.code, g.name, g.position, el.name AS education_level_name FROM grades g JOIN education_levels el ON el.id = g.education_level_id WHERE ($1::text IS NULL OR g.name ILIKE $2 OR g.code ILIKE $2 OR el.name ILIKE $2) AND ($3::bigint IS NULL OR g.education_level_id = $3) ORDER BY el.position, g.position, g.name",
    programs: "SELECT p.id, p.department_id, p.name, p.description, COALESCE(array_agg(tpl.grade_id::text) FILTER (WHERE tpl.grade_id IS NOT NULL), ARRAY[]::text[]) AS grade_ids FROM programs p LEFT JOIN tvet_program_levels tpl ON tpl.program_id = p.id WHERE ($1::text IS NULL OR p.name ILIKE $2 OR p.description ILIKE $2) GROUP BY p.id ORDER BY p.name",
    subjects: "SELECT s.id, s.name, s.description, s.education_level_id, s.grade_id, s.program_id FROM library_subjects s WHERE ($1::text IS NULL OR s.name ILIKE $2 OR s.description ILIKE $2) AND ($3::bigint IS NULL OR s.education_level_id = $3) AND ($4::bigint IS NULL OR s.grade_id = $4) AND ($5::bigint IS NULL OR s.program_id IS NOT DISTINCT FROM $5::bigint) ORDER BY s.name",
    courses: "SELECT c.id, c.title, c.description, c.difficulty, c.status, c.subject_id, c.education_level_id, c.grade_id, c.program_id, s.name AS subject, u.name AS teacher, c.teacher_id, c.created_at, c.updated_at FROM library_courses c JOIN library_subjects s ON s.id = c.subject_id LEFT JOIN users u ON u.id = c.teacher_id WHERE ($1::text IS NULL OR c.title ILIKE $2 OR c.description ILIKE $2 OR s.name ILIKE $2) AND ($3::bigint IS NULL OR c.education_level_id = $3) AND ($4::bigint IS NULL OR c.grade_id = $4) AND ($5::bigint IS NULL OR c.program_id IS NOT DISTINCT FROM $5::bigint) AND ($6::bigint IS NULL OR c.subject_id = $6) ORDER BY c.updated_at DESC, c.title",
    modules: "SELECT m.id, m.course_id, m.title, m.position, m.status, c.title AS course, c.education_level_id, c.grade_id, c.program_id, c.subject_id FROM course_modules m JOIN library_courses c ON c.id = m.course_id WHERE ($1::text IS NULL OR m.title ILIKE $2 OR c.title ILIKE $2) AND ($3::bigint IS NULL OR c.education_level_id = $3) AND ($4::bigint IS NULL OR c.grade_id = $4) AND ($5::bigint IS NULL OR c.program_id IS NOT DISTINCT FROM $5::bigint) AND ($6::bigint IS NULL OR c.subject_id = $6) ORDER BY c.title, m.position",
    lessons: "SELECT l.id, l.module_id, l.title, l.explanation AS body, l.explanation AS content, l.position, l.status, l.language, m.title AS module, c.id AS course_id, c.title AS course, c.education_level_id, c.grade_id, c.program_id, c.subject_id FROM course_lessons l JOIN course_modules m ON m.id = l.module_id JOIN library_courses c ON c.id = m.course_id WHERE ($1::text IS NULL OR l.title ILIKE $2 OR l.explanation ILIKE $2) AND ($3::bigint IS NULL OR c.education_level_id = $3) AND ($4::bigint IS NULL OR c.grade_id = $4) AND ($5::bigint IS NULL OR c.program_id IS NOT DISTINCT FROM $5::bigint) AND ($6::bigint IS NULL OR c.subject_id = $6) ORDER BY c.title, m.position, l.position",
    notes: "SELECT n.id, n.lesson_id, n.title, n.body, n.status, l.title AS lesson, c.title AS course, c.education_level_id, c.grade_id, c.program_id, c.subject_id FROM lesson_notes n JOIN course_lessons l ON l.id = n.lesson_id JOIN course_modules m ON m.id = l.module_id JOIN library_courses c ON c.id = m.course_id WHERE ($1::text IS NULL OR n.title ILIKE $2 OR n.body ILIKE $2) AND ($3::bigint IS NULL OR c.education_level_id = $3) AND ($4::bigint IS NULL OR c.grade_id = $4) AND ($5::bigint IS NULL OR c.program_id IS NOT DISTINCT FROM $5::bigint) AND ($6::bigint IS NULL OR c.subject_id = $6) ORDER BY c.title, l.position, n.position",
    examples: "SELECT e.id, e.lesson_id, e.title, e.body, e.status, l.title AS lesson, c.title AS course, c.education_level_id, c.grade_id, c.program_id, c.subject_id FROM lesson_examples e JOIN course_lessons l ON l.id = e.lesson_id JOIN course_modules m ON m.id = l.module_id JOIN library_courses c ON c.id = m.course_id WHERE ($1::text IS NULL OR e.title ILIKE $2 OR e.body ILIKE $2) AND ($3::bigint IS NULL OR c.education_level_id = $3) AND ($4::bigint IS NULL OR c.grade_id = $4) AND ($5::bigint IS NULL OR c.program_id IS NOT DISTINCT FROM $5::bigint) AND ($6::bigint IS NULL OR c.subject_id = $6) ORDER BY c.title, l.position, e.position",
    exercises: "SELECT x.id, x.lesson_id, x.prompt, x.answer, x.status, l.title AS lesson, c.title AS course, c.education_level_id, c.grade_id, c.program_id, c.subject_id FROM lesson_exercises x JOIN course_lessons l ON l.id = x.lesson_id JOIN course_modules m ON m.id = l.module_id JOIN library_courses c ON c.id = m.course_id WHERE ($1::text IS NULL OR x.prompt ILIKE $2 OR x.answer ILIKE $2) AND ($3::bigint IS NULL OR c.education_level_id = $3) AND ($4::bigint IS NULL OR c.grade_id = $4) AND ($5::bigint IS NULL OR c.program_id IS NOT DISTINCT FROM $5::bigint) AND ($6::bigint IS NULL OR c.subject_id = $6) ORDER BY c.title, l.position, x.position",
    assignments: "SELECT a.id, a.course_id, a.title, a.instructions, a.due_at, a.total_marks, a.status, c.title AS course, c.education_level_id, c.grade_id, c.program_id, c.subject_id FROM library_assessments a JOIN library_courses c ON c.id = a.course_id WHERE a.kind = 'homework' AND ($1::text IS NULL OR a.title ILIKE $2 OR a.instructions ILIKE $2) AND ($3::bigint IS NULL OR c.education_level_id = $3) AND ($4::bigint IS NULL OR c.grade_id = $4) AND ($5::bigint IS NULL OR c.program_id IS NOT DISTINCT FROM $5::bigint) AND ($6::bigint IS NULL OR c.subject_id = $6) ORDER BY a.due_at NULLS LAST",
    quizzes: "SELECT q.id, q.course_id, q.lesson_id, q.title, q.status, q.published, c.title AS course, c.education_level_id, c.grade_id, c.program_id, c.subject_id FROM library_quizzes q JOIN library_courses c ON c.id = q.course_id WHERE ($1::text IS NULL OR q.title ILIKE $2 OR c.title ILIKE $2) AND ($3::bigint IS NULL OR c.education_level_id = $3) AND ($4::bigint IS NULL OR c.grade_id = $4) AND ($5::bigint IS NULL OR c.program_id IS NOT DISTINCT FROM $5::bigint) AND ($6::bigint IS NULL OR c.subject_id = $6) ORDER BY q.title",
    tests: "SELECT a.id, a.course_id, a.title, a.instructions, a.time_limit_seconds, a.status, c.title AS course, c.education_level_id, c.grade_id, c.program_id, c.subject_id FROM library_assessments a JOIN library_courses c ON c.id = a.course_id WHERE a.kind = 'test' AND ($1::text IS NULL OR a.title ILIKE $2 OR a.instructions ILIKE $2) AND ($3::bigint IS NULL OR c.education_level_id = $3) AND ($4::bigint IS NULL OR c.grade_id = $4) AND ($5::bigint IS NULL OR c.program_id IS NOT DISTINCT FROM $5::bigint) AND ($6::bigint IS NULL OR c.subject_id = $6) ORDER BY a.title",
    exams: "SELECT a.id, a.course_id, a.title, a.time_limit_seconds, a.status, c.title AS course, c.education_level_id, c.grade_id, c.program_id, c.subject_id FROM library_assessments a JOIN library_courses c ON c.id = a.course_id WHERE a.kind = 'exam' AND ($1::text IS NULL OR a.title ILIKE $2 OR a.instructions ILIKE $2) AND ($3::bigint IS NULL OR c.education_level_id = $3) AND ($4::bigint IS NULL OR c.grade_id = $4) AND ($5::bigint IS NULL OR c.program_id IS NOT DISTINCT FROM $5::bigint) AND ($6::bigint IS NULL OR c.subject_id = $6) ORDER BY a.title",
};
const listParameterCounts = { levels: 2, grades: 3, programs: 2, subjects: 5, courses: 6, modules: 6, lessons: 6, notes: 6, examples: 6, exercises: 6, assignments: 6, quizzes: 6, tests: 6, exams: 6 };

router.get("/overview", async (req, res) => {
    try {
        const result = await pool.query(`SELECT
            (SELECT count(*)::int FROM users WHERE role = 'student') AS students,
            (SELECT count(*)::int FROM users WHERE role = 'teacher') AS teachers,
            (SELECT count(*)::int FROM users WHERE role = 'teacher' AND teacher_verification_status = 'pending') AS pending_teachers,
            (SELECT count(*)::int FROM library_courses) AS courses,
            (SELECT count(*)::int FROM library_subjects) AS subjects,
            (SELECT count(*)::int FROM library_courses WHERE status = 'published') AS published_courses,
            (SELECT count(*)::int FROM course_lessons WHERE status = 'published') AS published_lessons,
            (SELECT count(*)::int FROM library_courses WHERE status = 'draft') AS draft_courses,
            (SELECT count(*)::int FROM admin_audit_logs WHERE created_at >= now() - interval '30 days') AS recent_actions`);
        res.json({ data: result.rows[0] });
    } catch (error) { console.error("ADMIN OVERVIEW ERROR:", error.message); res.status(500).json({ message: "Admin overview is temporarily unavailable." }); }
});

router.get("/taxonomy", async (_req, res) => {
    try {
        const [levels, grades, programs, subjects] = await Promise.all([
            pool.query("SELECT id, code, name, category, position FROM education_levels ORDER BY position, name"),
            pool.query("SELECT g.id, g.education_level_id, g.code, g.name, g.position, el.name AS education_level_name FROM grades g JOIN education_levels el ON el.id = g.education_level_id ORDER BY el.position, g.position, g.name"),
            pool.query("SELECT p.id, p.department_id, p.name, p.description, COALESCE(array_agg(tpl.grade_id::text) FILTER (WHERE tpl.grade_id IS NOT NULL), ARRAY[]::text[]) AS grade_ids FROM programs p LEFT JOIN tvet_program_levels tpl ON tpl.program_id = p.id GROUP BY p.id ORDER BY p.name"),
            pool.query("SELECT id, name, description, education_level_id, grade_id, program_id FROM library_subjects ORDER BY name"),
        ]);
        res.json({ data: { levels: levels.rows, grades: grades.rows, programs: programs.rows, subjects: subjects.rows } });
    } catch (error) { console.error("ADMIN TAXONOMY ERROR:", error.message); res.status(500).json({ message: "Admin taxonomy is temporarily unavailable." }); }
});

router.get("/users", async (req, res) => {
    const search = text(req.query.search).slice(0, 120);
    const role = ["student", "teacher", "admin", "super-admin"].includes(req.query.role) ? req.query.role : null;
    const status = ["active", "pending", "suspended"].includes(req.query.status) ? req.query.status : null;
    try {
        const result = await pool.query("SELECT id, name AS full_name, email, role, status, created_at, NULL::timestamptz AS last_login_at FROM users WHERE ($1 = '' OR name ILIKE $2 OR email ILIKE $2) AND ($3::text IS NULL OR role = $3) AND ($4::text IS NULL OR status = $4) ORDER BY created_at DESC LIMIT 500", [search, `%${search}%`, role, status]);
        res.json({ data: result.rows });
    } catch (error) { console.error("ADMIN USERS ERROR:", error.message); res.status(500).json({ message: "Users are temporarily unavailable." }); }
});

router.patch("/users/:id/status", async (req, res) => {
    const userId = positiveInteger(req.params.id, "User ID");
    const nextStatus = text(req.body.status);
    if (!["active", "pending", "suspended"].includes(nextStatus)) return res.status(400).json({ message: "Invalid user status." });
    if (String(userId) === String(req.auth.userId)) return res.status(400).json({ message: "You cannot change your own account status." });
    try {
        const result = await pool.query("UPDATE users SET status = $1 WHERE id = $2 AND role = 'student' RETURNING id, name AS full_name, email, role, status", [nextStatus, userId]);
        if (!result.rows[0]) return res.status(404).json({ message: "Student not found." });
        await audit(req, "user.status_changed", "user", userId, { status: nextStatus });
        res.json({ data: result.rows[0] });
    } catch (error) { console.error("ADMIN USER STATUS ERROR:", error.message); res.status(500).json({ message: "User status could not be updated." }); }
});

router.get("/teachers", async (_req, res) => {
    try {
        const result = await pool.query(`SELECT u.id, u.name AS full_name, u.email, u.status, u.created_at, u.teacher_verification_status, u.bio,
            COALESCE(string_agg(DISTINCT s.name, ', ' ORDER BY s.name), '') AS subjects,
            count(DISTINCT c.id)::int AS courses,
            COALESCE(array_agg(DISTINCT tp.permission) FILTER (WHERE tp.permission IS NOT NULL), '{}') AS permissions
            FROM users u LEFT JOIN library_courses c ON c.teacher_id = u.id LEFT JOIN library_subjects s ON s.id = c.subject_id
            LEFT JOIN teacher_permissions tp ON tp.teacher_id = u.id WHERE u.role = 'teacher'
            GROUP BY u.id ORDER BY u.name`);
        res.json({ data: result.rows });
    } catch (error) { console.error("ADMIN TEACHERS ERROR:", error.message); res.status(500).json({ message: "Teachers are temporarily unavailable." }); }
});

router.get("/review", async (_req, res) => {
    try {
        const result = await pool.query(`SELECT c.id, 'course' AS content_type, c.title, c.status, c.updated_at AS created_at, u.name AS teacher, s.name AS subject, g.name AS class_name, p.name AS program
            FROM library_courses c LEFT JOIN users u ON u.id = c.teacher_id JOIN library_subjects s ON s.id = c.subject_id
            LEFT JOIN grades g ON g.id = c.grade_id LEFT JOIN programs p ON p.id = c.program_id WHERE c.status = 'pending'
            UNION ALL SELECT l.id, 'lesson', l.title, l.status, now(), u.name, s.name, g.name, p.name
            FROM course_lessons l JOIN course_modules m ON m.id = l.module_id JOIN library_courses c ON c.id = m.course_id
            LEFT JOIN users u ON u.id = c.teacher_id JOIN library_subjects s ON s.id = c.subject_id LEFT JOIN grades g ON g.id = c.grade_id LEFT JOIN programs p ON p.id = c.program_id WHERE l.status = 'pending'
            ORDER BY created_at DESC`);
        res.json({ data: result.rows });
    } catch (error) { console.error("ADMIN REVIEW ERROR:", error.message); res.status(500).json({ message: "Review queue is temporarily unavailable." }); }
});

router.post("/teachers", async (req, res) => {
    const email = text(req.body.email, "Email", true, 255).toLowerCase();
    const name = text(req.body.fullName, "Full name", true, 120);
    const bio = text(req.body.bio, "Bio", false, 4000);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Enter a valid teacher email." });
    try {
        const temporaryPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 12);
        const result = await pool.query("INSERT INTO users (name,email,password_hash,role,status,email_verified_at,bio,teacher_verification_status) VALUES ($1,$2,$3,'teacher','pending',NULL,$4,'pending') RETURNING id,name AS full_name,email,role,status,created_at,teacher_verification_status", [name, email, temporaryPasswordHash, bio]);
        await audit(req, "teacher.created", "teacher", result.rows[0].id, { email });
        res.status(201).json({ data: result.rows[0] });
    } catch (error) {
        if (error.code === "23505") return res.status(409).json({ message: "An account with that email already exists." });
        console.error("ADMIN TEACHER CREATE ERROR:", error.message);
        res.status(500).json({ message: "Teacher could not be created." });
    }
});

router.get("/audit-logs", async (_req, res) => {
    try {
        const result = await pool.query("SELECT id, actor_id, action, entity_type, entity_id, metadata, created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT 200");
        res.json({ data: result.rows });
    } catch (error) { console.error("ADMIN AUDIT ERROR:", error.message); res.status(500).json({ message: "Audit logs are temporarily unavailable." }); }
});

router.get("/schools", async (req, res) => {
    const search = text(req.query.search).slice(0, 120);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    try {
        const pattern = `%${search}%`;
        const [rows, count] = await Promise.all([
            pool.query("SELECT id, name, location, phone, email, status, created_at FROM admin_schools WHERE ($1 = '' OR name ILIKE $2 OR location ILIKE $2 OR email ILIKE $2) ORDER BY created_at DESC LIMIT $3 OFFSET $4", [search, pattern, limit, offset]),
            pool.query("SELECT count(*)::int AS total FROM admin_schools WHERE ($1 = '' OR name ILIKE $2 OR location ILIKE $2 OR email ILIKE $2)", [search, pattern]),
        ]);
        res.json({ data: rows.rows, meta: { total: count.rows[0].total, limit, offset } });
    } catch (error) { console.error("ADMIN SCHOOLS ERROR:", error.message); res.status(500).json({ message: "Schools are temporarily unavailable. Apply the legacy admin dashboard migration if it has not been run." }); }
});

router.post("/schools", async (req, res) => {
    const name = text(req.body.name, "School name", true, 160);
    const location = text(req.body.location, "Location", false, 240);
    const phone = text(req.body.phone, "Phone", false, 40);
    const email = text(req.body.email, "Email", true, 255).toLowerCase();
    const status = ["active", "inactive", "pending"].includes(req.body.status) ? req.body.status : "pending";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Enter a valid school email." });
    try {
        const result = await pool.query("INSERT INTO admin_schools (name, location, phone, email, status, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, location, phone, email, status, created_at", [name, location, phone, email, status, req.auth.userId]);
        await audit(req, "school.created", "school", result.rows[0].id);
        res.status(201).json({ data: result.rows[0] });
    } catch (error) {
        if (error.code === "23505") return res.status(409).json({ message: "A school with that email already exists." });
        console.error("ADMIN SCHOOL CREATE ERROR:", error.message); res.status(500).json({ message: "School could not be created." });
    }
});

router.patch("/schools/:id", async (req, res) => {
    const schoolId = positiveInteger(req.params.id, "School ID");
    const allowed = { name: "name", location: "location", phone: "phone", email: "email", status: "status" };
    const columns = Object.entries(allowed).filter(([key]) => Object.hasOwn(req.body, key));
    if (!columns.length) return res.status(400).json({ message: "Provide at least one field to update." });
    const values = [];
    const assignments = columns.map(([key, column]) => {
        let value = req.body[key];
        if (key === "name") value = text(value, "School name", true, 160);
        else if (key === "location") value = text(value, "Location", false, 240);
        else if (key === "phone") value = text(value, "Phone", false, 40);
        else if (key === "email") {
            value = text(value, "Email", true, 255).toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw httpError(400, "Enter a valid school email.");
        } else if (!["active", "inactive", "pending"].includes(value)) throw httpError(400, "Invalid school status.");
        values.push(value);
        return `${column} = $${values.length}`;
    });
    values.push(schoolId);
    try {
        const result = await pool.query(`UPDATE admin_schools SET ${assignments.join(", ")}, updated_at = now() WHERE id = $${values.length} RETURNING id, name, location, phone, email, status, created_at`, values);
        if (!result.rows[0]) return res.status(404).json({ message: "School not found." });
        await audit(req, "school.updated", "school", schoolId);
        res.json({ data: result.rows[0] });
    } catch (error) {
        if (error.code === "23505") return res.status(409).json({ message: "A school with that email already exists." });
        if (error.status) return res.status(error.status).json({ message: error.message });
        console.error("ADMIN SCHOOL UPDATE ERROR:", error.message); res.status(500).json({ message: "School could not be updated." });
    }
});

router.delete("/schools/:id", async (req, res) => {
    const schoolId = positiveInteger(req.params.id, "School ID");
    try {
        const result = await pool.query("DELETE FROM admin_schools WHERE id = $1 RETURNING id", [schoolId]);
        if (!result.rows[0]) return res.status(404).json({ message: "School not found." });
        await audit(req, "school.deleted", "school", schoolId);
        res.status(204).send();
    } catch (error) { console.error("ADMIN SCHOOL DELETE ERROR:", error.message); res.status(500).json({ message: "School could not be deleted." }); }
});

router.get("/results", async (_req, res) => {
    try {
        const result = await pool.query(`SELECT a.id, u.name AS student, a.student_id, c.title AS course, q.title AS assessment, 'Quiz' AS assessment_type, a.score::numeric AS score, 100::numeric AS total, a.submitted_at
            FROM library_quiz_attempts a
            JOIN users u ON u.id = a.student_id AND u.role = 'student'
            JOIN library_quizzes q ON q.id = a.quiz_id
            JOIN library_courses c ON c.id = q.course_id
            ORDER BY a.submitted_at DESC LIMIT 500`);
        res.json({ data: result.rows });
    } catch (error) { console.error("ADMIN RESULTS ERROR:", error.message); res.status(500).json({ message: "Results are temporarily unavailable." }); }
});

router.get("/activities", async (_req, res) => {
    try {
        const result = await pool.query("SELECT l.id, l.actor_id, u.name AS actor, l.action, l.entity_type, l.entity_id, l.metadata, l.created_at FROM admin_audit_logs l LEFT JOIN users u ON u.id = l.actor_id ORDER BY l.created_at DESC LIMIT 100");
        res.json({ data: result.rows });
    } catch (error) { console.error("ADMIN ACTIVITIES ERROR:", error.message); res.status(500).json({ message: "Activity history is temporarily unavailable." }); }
});

router.get("/notifications", async (req, res) => {
    try {
        const result = await pool.query("SELECT id, title, body, read_at, created_at FROM admin_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50", [req.auth.userId]);
        res.json({ data: result.rows });
    } catch (error) { console.error("ADMIN NOTIFICATIONS ERROR:", error.message); res.status(500).json({ message: "Notifications are temporarily unavailable. Apply the legacy admin dashboard migration if it has not been run." }); }
});

router.patch("/notifications/read", async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map((value) => positiveInteger(value, "Notification ID")) : [];
    const all = req.body.all === true;
    if (!all && !ids.length) return res.status(400).json({ message: "Provide notification IDs or set all to true." });
    if (ids.length > 100) return res.status(400).json({ message: "At most 100 notification IDs can be updated at once." });
    try {
        const result = all
            ? await pool.query("UPDATE admin_notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL RETURNING id", [req.auth.userId])
            : await pool.query("UPDATE admin_notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::bigint[]) AND read_at IS NULL RETURNING id", [req.auth.userId, ids]);
        res.json({ data: result.rows });
    } catch (error) { console.error("ADMIN NOTIFICATION READ ERROR:", error.message); res.status(500).json({ message: "Notifications could not be marked as read." }); }
});

router.get("/classes", async (_req, res) => {
    try {
        const result = await pool.query(`SELECT s.id, s.course_id, c.title, s.teacher_id, u.name AS teacher, s.starts_at, s.ends_at, s.room
            FROM admin_class_schedule s JOIN library_courses c ON c.id = s.course_id JOIN users u ON u.id = s.teacher_id
            WHERE s.starts_at >= now() ORDER BY s.starts_at LIMIT 100`);
        res.json({ data: result.rows });
    } catch (error) { console.error("ADMIN CLASS SCHEDULE ERROR:", error.message); res.status(500).json({ message: "Class schedules are temporarily unavailable. Apply the legacy admin dashboard migration if it has not been run." }); }
});

router.post("/classes", async (req, res) => {
    const courseId = positiveInteger(req.body.courseId, "Course ID");
    const startsAt = new Date(req.body.startsAt);
    const endsAt = new Date(req.body.endsAt);
    const room = text(req.body.room, "Room", false, 160);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) return res.status(400).json({ message: "Choose valid class start and end times." });
    try {
        const course = await pool.query("SELECT c.teacher_id FROM library_courses c JOIN users u ON u.id = c.teacher_id AND u.role = 'teacher' AND u.status = 'active' WHERE c.id = $1", [courseId]);
        if (!course.rows[0]) return res.status(404).json({ message: "Course or active teacher not found." });
        const result = await pool.query("INSERT INTO admin_class_schedule (course_id, teacher_id, starts_at, ends_at, room, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, course_id, teacher_id, starts_at, ends_at, room", [courseId, course.rows[0].teacher_id, startsAt, endsAt, room, req.auth.userId]);
        await audit(req, "class.scheduled", "class", result.rows[0].id);
        res.status(201).json({ data: result.rows[0] });
    } catch (error) { console.error("ADMIN CLASS CREATE ERROR:", error.message); res.status(500).json({ message: "Class could not be scheduled." }); }
});

router.get("/content/:type", async (req, res) => {
    const type = req.params.type;
    const query = listQueries[type];
    if (!query) return res.status(400).json({ message: "Unsupported content type." });
    const search = text(req.query.search).slice(0, 120);
    const levelId = optionalInteger(req.query.level);
    const gradeId = optionalInteger(req.query.grade);
    const programNone = req.query.program === "none";
    const programId = req.query.program === undefined ? null : programNone ? 0 : optionalInteger(req.query.program);
    const subjectId = optionalInteger(req.query.subject);
    try {
        const programColumn = type === "subjects" ? "s.program_id" : "c.program_id";
        const programCondition = `($5::bigint IS NULL OR ${programColumn} IS NOT DISTINCT FROM $5::bigint)`;
        const filteredQuery = programNone && ["subjects", "courses", "modules", "lessons", "notes", "examples", "exercises", "assignments", "quizzes", "tests", "exams"].includes(type)
            ? query.replace(programCondition, `($5::bigint IS NULL OR ($5 = 0 AND ${programColumn} IS NULL) OR ($5 > 0 AND ${programColumn} = $5))`)
            : query;
        const values = [search || null, `%${search}%`, levelId, gradeId, programId, subjectId].slice(0, listParameterCounts[type]);
        const count = await pool.query(`SELECT count(*)::int AS total FROM (${filteredQuery}) AS filtered_content`, values);
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
        const offset = Math.max(0, Number(req.query.offset) || 0);
        const result = await pool.query(`${filteredQuery} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset]);
        res.json({ data: result.rows, meta: { total: count.rows[0].total, limit, offset } });
    } catch (error) { console.error("ADMIN CONTENT LIST ERROR:", error.message); res.status(500).json({ message: "Content is temporarily unavailable." }); }
});

router.post("/content/:type", async (req, res) => {
    const type = req.params.type;
    const body = req.body || {};
    let result;
    try {
        if (type === "levels") result = await pool.query("INSERT INTO education_levels (name, code, category, position) VALUES ($1, $2, $3, $4) RETURNING *", [text(body.name, "Name", true, 120), text(body.code, "Code", true, 40).toUpperCase(), text(body.category, "Category") || "CUSTOM", Number(body.position) || 0]);
        else if (type === "grades") {
            const levelId = positiveInteger(body.educationLevelId, "Education level");
            const level = await pool.query("SELECT 1 FROM education_levels WHERE id = $1", [levelId]);
            if (!level.rows[0]) throw httpError(400, "Education level does not exist.");
            result = await pool.query("INSERT INTO grades (education_level_id, name, code, position) VALUES ($1, $2, $3, $4) RETURNING *", [levelId, text(body.name, "Name", true, 120), text(body.code, "Code", true, 40).toUpperCase(), Number(body.position) || 0]);
        } else if (type === "programs") result = await pool.query("INSERT INTO programs (department_id, name, description) VALUES ($1, $2, $3) RETURNING *", [optionalInteger(body.departmentId), text(body.name, "Name", true, 160), text(body.description, "Description")]);
        else if (type === "subjects") {
            const target = await targetFrom(body, false);
            result = await pool.query("INSERT INTO library_subjects (name, description, education_level_id, grade_id, program_id, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *", [text(body.name, "Name", true, 160), text(body.description, "Description"), target.educationLevelId, target.gradeId, target.programId, req.auth.userId]);
        } else if (type === "courses") {
            const target = await targetFrom(body, true);
            const teacherId = optionalInteger(body.teacherId);
            if (teacherId) {
                const teacher = await pool.query("SELECT 1 FROM users WHERE id = $1 AND role = 'teacher'", [teacherId]);
                if (!teacher.rows[0]) throw httpError(400, "Choose an existing teacher account.");
            }
            result = await pool.query("INSERT INTO library_courses (subject_id, education_level_id, grade_id, program_id, teacher_id, title, description, difficulty, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft') RETURNING *", [target.subjectId, target.educationLevelId, target.gradeId, target.programId, teacherId, text(body.title, "Title", true, 240), text(body.description, "Description"), text(body.difficulty, "Difficulty") || "Beginner"]);
        } else if (["modules", "lessons", "notes", "examples", "exercises", "assignments", "quizzes", "tests", "exams"].includes(type)) {
            const target = await targetFrom(body, true);
            if (type === "modules") {
                const courseId = positiveInteger(body.courseId, "Course"); await assertCourseTarget(courseId, target);
                result = await pool.query("INSERT INTO course_modules (course_id, title, position, status) VALUES ($1,$2,$3,'draft') RETURNING *", [courseId, text(body.title, "Title", true, 240), Number(body.position) || 0]);
            } else if (type === "lessons") {
                const moduleId = positiveInteger(body.moduleId, "Module"); const courseId = await ownedCourseFor("modules", moduleId); await assertCourseTarget(courseId, target);
                result = await pool.query("INSERT INTO course_lessons (module_id, title, explanation, key_points, definitions, summary, position, language, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft') RETURNING *", [moduleId, text(body.title, "Title", true, 240), text(body.body || body.explanation, "Lesson content"), JSON.stringify(Array.isArray(body.keyPoints) ? body.keyPoints : []), JSON.stringify(Array.isArray(body.definitions) ? body.definitions : []), text(body.summary), Number(body.position) || 0, text(body.language) || "English"]);
            } else if (["notes", "examples", "exercises"].includes(type)) {
                const lessonId = positiveInteger(body.lessonId, "Lesson"); const courseId = await ownedCourseFor("lessons", lessonId); await assertCourseTarget(courseId, target);
                if (type === "notes") result = await pool.query("INSERT INTO lesson_notes (lesson_id,title,body,position,status) VALUES ($1,$2,$3,$4,'draft') RETURNING *", [lessonId, text(body.title, "Title", true, 240), text(body.body, "Body", true), Number(body.position) || 0]);
                else if (type === "examples") result = await pool.query("INSERT INTO lesson_examples (lesson_id,title,body,position,status) VALUES ($1,$2,$3,$4,'draft') RETURNING *", [lessonId, text(body.title, "Title", true, 240), text(body.body, "Body", true), Number(body.position) || 0]);
                else result = await pool.query("INSERT INTO lesson_exercises (lesson_id,prompt,answer,position,status) VALUES ($1,$2,$3,$4,'draft') RETURNING *", [lessonId, text(body.prompt, "Prompt", true), text(body.answer, "Answer"), Number(body.position) || 0]);
            } else if (type === "quizzes") {
                const courseId = positiveInteger(body.courseId, "Course"); await assertCourseTarget(courseId, target);
                result = await pool.query("INSERT INTO library_quizzes (course_id,lesson_id,title,published,status) VALUES ($1,$2,$3,false,'draft') RETURNING *", [courseId, optionalInteger(body.lessonId), text(body.title, "Title", true, 240)]);
            } else {
                const courseId = positiveInteger(body.courseId, "Course"); await assertCourseTarget(courseId, target);
                const kind = type === "assignments" ? "homework" : type === "tests" ? "test" : "exam";
                result = await pool.query("INSERT INTO library_assessments (kind,course_id,title,instructions,due_at,total_marks,time_limit_seconds,status) VALUES ($1,$2,$3,$4,$5,$6,$7,'draft') RETURNING *", [kind, courseId, text(body.title, "Title", true, 240), text(body.instructions, "Instructions"), body.dueAt ? new Date(body.dueAt) : null, Number(body.totalMarks) || 100, optionalInteger(body.timeLimitSeconds)]);
            }
        } else throw httpError(400, "Unsupported content type.");
        await audit(req, "content.created", type, result.rows[0].id, { target: body.educationLevelId ? body : undefined });
        res.status(201).json({ data: result.rows[0] });
    } catch (error) { if (error.status) return res.status(error.status).json({ message: error.message }); console.error("ADMIN CONTENT CREATE ERROR:", error.message); res.status(500).json({ message: "Content could not be created." }); }
});

router.patch("/content/:type/:id", async (req, res) => {
    const type = req.params.type; const id = optionalInteger(req.params.id); const body = req.body || {};
    if (!id || !contentTypes.has(type)) return res.status(400).json({ message: "Invalid content type or id." });
    const tables = { levels: "education_levels", grades: "grades", programs: "programs", subjects: "library_subjects", courses: "library_courses", modules: "course_modules", lessons: "course_lessons", notes: "lesson_notes", examples: "lesson_examples", exercises: "lesson_exercises", assignments: "library_assessments", quizzes: "library_quizzes", tests: "library_assessments", exams: "library_assessments" };
    const fieldsByType = {
        levels: { name: "name", code: "code", category: "category", position: "position" },
        grades: { name: "name", code: "code", position: "position" },
        programs: { name: "name", description: "description", departmentId: "department_id" },
        subjects: { name: "name", description: "description" },
        courses: { title: "title", description: "description", difficulty: "difficulty", teacherId: "teacher_id" },
        modules: { title: "title", position: "position" },
        lessons: { title: "title", body: "explanation", explanation: "explanation", summary: "summary", language: "language", position: "position" },
        notes: { title: "title", body: "body", position: "position" },
        examples: { title: "title", body: "body", position: "position" },
        exercises: { prompt: "prompt", answer: "answer", position: "position" },
        assignments: { title: "title", instructions: "instructions", dueAt: "due_at", totalMarks: "total_marks" },
        quizzes: { title: "title", lessonId: "lesson_id" },
        tests: { title: "title", instructions: "instructions", timeLimitSeconds: "time_limit_seconds" },
        exams: { title: "title", timeLimitSeconds: "time_limit_seconds" },
    };
    try {
        if (type === "courses" && ["educationLevelId", "gradeId", "programId", "subjectId"].some((key) => key in body)) {
            const current = await pool.query("SELECT education_level_id, grade_id, program_id, subject_id FROM library_courses WHERE id = $1", [id]);
            if (!current.rows[0]) return res.status(404).json({ message: "Content not found." });
            const merged = { educationLevelId: body.educationLevelId ?? current.rows[0].education_level_id, gradeId: body.gradeId ?? current.rows[0].grade_id, programId: body.programId === undefined ? current.rows[0].program_id : body.programId, subjectId: body.subjectId ?? current.rows[0].subject_id };
            await targetFrom(merged, true);
            await pool.query("UPDATE library_courses SET education_level_id=$1, grade_id=$2, program_id=$3, subject_id=$4, updated_at=now() WHERE id=$5", [merged.educationLevelId, merged.gradeId, merged.programId, merged.subjectId, id]);
        }
        const allowed = fieldsByType[type]; const assignments = []; const values = [];
        for (const [key, column] of Object.entries(allowed)) {
            if (!(key in body)) continue;
            let value = body[key];
            if (["teacherId", "departmentId", "lessonId"].includes(key)) value = optionalInteger(value);
            if (key === "dueAt" && value) value = new Date(value);
            if (typeof value === "string" && value.length > 10000) throw httpError(400, "Field value is too long.");
            assignments.push(`${column} = $${values.length + 1}`); values.push(value);
        }
        if (type === "assignments" || type === "tests" || type === "exams") {
            if (!assignments.length) throw httpError(400, "No editable fields supplied.");
            const kind = type === "assignments" ? "homework" : type === "tests" ? "test" : "exam";
            if (assignments.length) assignments.push(`updated_at=now()`);
            const result = await pool.query(`UPDATE library_assessments SET ${assignments.join(", ")} WHERE id=$${values.length + 2} AND kind=$${values.length + 1} RETURNING *`, [...values, kind, id]);
            if (!result.rows[0]) return res.status(404).json({ message: "Content not found." });
            await audit(req, "content.updated", type, id, { fields: Object.keys(body) });
            return res.json({ data: result.rows[0] });
        }
        if ("status" in body && !["levels", "grades", "programs", "subjects"].includes(type)) { assignments.push(`status=$${values.length + 1}`); values.push(statusValue(body.status)); }
        if (!assignments.length) throw httpError(400, "No editable fields supplied.");
        if (type === "courses") assignments.push("updated_at=now()");
        if (type === "quizzes" && body.status) { assignments.push(`published=$${values.length + 1}`); values.push(body.status === "published"); }
        values.push(id);
        const result = await pool.query(`UPDATE ${tables[type]} SET ${assignments.join(", ")} WHERE id=$${values.length} RETURNING *`, values);
        if (!result.rows[0]) return res.status(404).json({ message: "Content not found." });
        await audit(req, "content.updated", type, id, { fields: Object.keys(body) });
        res.json({ data: result.rows[0] });
    } catch (error) { if (error.status) return res.status(error.status).json({ message: error.message }); console.error("ADMIN CONTENT UPDATE ERROR:", error.message); res.status(500).json({ message: "Content could not be updated." }); }
});

router.patch("/content/:type/:id/status", async (req, res) => {
    const type = req.params.type; const id = optionalInteger(req.params.id); const nextStatus = statusValue(req.body.status);
    const statusTables = { courses: "library_courses", modules: "course_modules", lessons: "course_lessons", notes: "lesson_notes", examples: "lesson_examples", exercises: "lesson_exercises", assignments: "library_assessments", tests: "library_assessments", exams: "library_assessments", quizzes: "library_quizzes" };
    if (!statusTables[type] || !id) return res.status(400).json({ message: "Invalid content type or id." });
    try {
        const result = type === "assignments" || type === "tests" || type === "exams"
            ? await pool.query("UPDATE library_assessments SET status = $1, updated_at = now() WHERE id = $2 AND kind = $3 RETURNING *", [nextStatus, id, type === "assignments" ? "homework" : type === "tests" ? "test" : "exam"])
            : await pool.query(`UPDATE ${statusTables[type]} SET status = $1 WHERE id = $2 RETURNING *`, [nextStatus, id]);
        if (!result.rows[0]) return res.status(404).json({ message: "Content not found." });
        if (type === "quizzes") await pool.query("UPDATE library_quizzes SET published = $1 WHERE id = $2", [nextStatus === "published", id]);
        await audit(req, `content.${nextStatus}`, type, id);
        res.json({ data: result.rows[0] });
    } catch (error) { console.error("ADMIN CONTENT STATUS ERROR:", error.message); res.status(500).json({ message: "Content status could not be changed." }); }
});

router.delete("/content/:type/:id", async (req, res) => {
    const type = req.params.type; const id = optionalInteger(req.params.id);
    const tables = { levels: "education_levels", grades: "grades", programs: "programs", subjects: "library_subjects", courses: "library_courses", modules: "course_modules", lessons: "course_lessons", notes: "lesson_notes", examples: "lesson_examples", exercises: "lesson_exercises", assignments: "library_assessments", tests: "library_assessments", exams: "library_assessments", quizzes: "library_quizzes" };
    if (!tables[type] || !id) return res.status(400).json({ message: "Invalid content type or id." });
    try {
        const result = ["assignments", "tests", "exams"].includes(type)
            ? await pool.query("DELETE FROM library_assessments WHERE id = $1 AND kind = $2 RETURNING id", [id, type === "assignments" ? "homework" : type])
            : await pool.query(`DELETE FROM ${tables[type]} WHERE id = $1 RETURNING id`, [id]);
        if (!result.rows[0]) return res.status(404).json({ message: "Content not found." });
        await audit(req, "content.deleted", type, id);
        res.status(204).send();
    } catch (error) { console.error("ADMIN CONTENT DELETE ERROR:", error.message); res.status(500).json({ message: "Content could not be deleted." }); }
});

router.patch("/teachers/:id/status", async (req, res) => {
    const teacherId = optionalInteger(req.params.id); const next = text(req.body.status);
    if (!teacherId || !["pending", "approved", "verified", "suspended", "rejected"].includes(next)) return res.status(400).json({ message: "Invalid teacher or status." });
    try {
        const result = await pool.query("UPDATE users SET teacher_verification_status = $1, status = $2 WHERE id = $3 AND role = 'teacher' RETURNING id, name AS full_name, email, role, status, teacher_verification_status", [next, ["suspended", "rejected"].includes(next) ? "suspended" : "active", teacherId]);
        if (!result.rows[0]) return res.status(404).json({ message: "Teacher not found." });
        await audit(req, `teacher.${next}`, "teacher", teacherId);
        res.json({ data: result.rows[0] });
    } catch (error) { console.error("ADMIN TEACHER STATUS ERROR:", error.message); res.status(500).json({ message: "Teacher status could not be updated." }); }
});

router.put("/teachers/:id/permissions", async (req, res) => {
    const teacherId = optionalInteger(req.params.id); const permissions = Array.isArray(req.body.permissions) ? req.body.permissions.filter((value) => typeof value === "string").slice(0, 30) : null;
    if (!teacherId || !permissions) return res.status(400).json({ message: "Invalid teacher permissions." });
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const teacher = await client.query("SELECT id FROM users WHERE id = $1 AND role = 'teacher' FOR UPDATE", [teacherId]);
        if (!teacher.rows[0]) throw httpError(404, "Teacher not found.");
        await client.query("DELETE FROM teacher_permissions WHERE teacher_id = $1", [teacherId]);
        for (const permission of permissions) await client.query("INSERT INTO teacher_permissions (teacher_id, permission, granted_by) VALUES ($1,$2,$3)", [teacherId, permission.slice(0, 80), req.auth.userId]);
        await client.query("COMMIT");
        await audit(req, "teacher.permissions_changed", "teacher", teacherId, { permissions });
        res.json({ data: { teacherId, permissions } });
    } catch (error) { await client.query("ROLLBACK"); if (error.status) return res.status(error.status).json({ message: error.message }); console.error("ADMIN TEACHER PERMISSIONS ERROR:", error.message); res.status(500).json({ message: "Teacher permissions could not be saved." }); }
    finally { client.release(); }
});

router.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    res.status(error.status || 500).json({ message: error.status ? error.message : "Admin request could not be completed." });
});

module.exports = router;