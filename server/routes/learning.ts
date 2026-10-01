import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { asyncHandler } from '../errors.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

async function studentProfile(userId: string) {
    const result = await pool.query('SELECT education_level_id, grade_id, program_id FROM students WHERE user_id = $1', [userId])
    return result.rows[0] || null
}

async function canStudentSeeCourse(courseId: string, userId: string) {
    const profile = await studentProfile(userId)
    if (!profile?.education_level_id) return false
    const result = await pool.query(`SELECT 1 FROM courses c WHERE c.id = $1 AND c.status = 'published' AND c.education_level_id = $2 AND c.grade_id IS NOT DISTINCT FROM $3::uuid AND c.program_id IS NOT DISTINCT FROM $4::uuid`, [courseId, profile.education_level_id, profile.grade_id, profile.program_id])
    return Boolean(result.rows[0])
}

router.get('/subjects', asyncHandler(async (_request, response) => { const result = await pool.query('SELECT id, name, description FROM subjects ORDER BY name'); response.json({ data: result.rows }) }))
router.get('/taxonomy', asyncHandler(async (_request, response) => {
    const [levels, grades, faculties, programs] = await Promise.all([
        pool.query('SELECT id, name, code, position FROM education_levels ORDER BY position, name'),
        pool.query('SELECT id, education_level_id, name, code, position FROM grades ORDER BY position, name'),
        pool.query('SELECT id, name, description FROM faculties ORDER BY name'),
        pool.query('SELECT p.id, p.name, p.description, d.name AS department, f.name AS faculty FROM programs p LEFT JOIN departments d ON d.id = p.department_id LEFT JOIN faculties f ON f.id = d.faculty_id ORDER BY f.name, d.name, p.name'),
    ])
    response.json({ data: { levels: levels.rows, grades: grades.rows, faculties: faculties.rows, programs: programs.rows } })
}))
router.get('/search', asyncHandler(async (request, response) => {
    const query = z.string().trim().min(2).max(120).parse(request.query.q)
    const pattern = `%${query}%`
    const result = await pool.query(`
		SELECT 'course' AS result_type, c.id, c.title AS title, c.description, s.name AS subject
		FROM courses c JOIN subjects s ON s.id = c.subject_id
		WHERE c.status = 'published' AND (c.title ILIKE $1 OR c.description ILIKE $1 OR s.name ILIKE $1)
		UNION ALL
		SELECT 'lesson' AS result_type, l.id, l.title, left(l.content::text, 500), s.name
		FROM lessons l JOIN modules m ON m.id = l.module_id JOIN courses c ON c.id = m.course_id JOIN subjects s ON s.id = c.subject_id
		WHERE c.status = 'published' AND (l.title ILIKE $1 OR l.content::text ILIKE $1)
		ORDER BY title LIMIT 50`, [pattern])
    response.json({ data: result.rows })
}))
router.get('/courses', asyncHandler(async (request, response) => {
    const search = z.string().trim().max(120).optional().parse(request.query.search)
    const level = z.string().uuid().optional().parse(request.query.level)
    const grade = z.string().uuid().optional().parse(request.query.grade)
    const program = z.string().uuid().optional().parse(request.query.program)
    const profile = await studentProfile(request.auth!.userId)
    if (request.auth!.role === 'student' && !profile?.education_level_id) { response.json({ data: [] }); return }
    const effectiveLevel = request.auth!.role === 'student' ? profile?.education_level_id || null : level || null
    const effectiveGrade = request.auth!.role === 'student' ? profile?.grade_id || null : grade || null
    const effectiveProgram = request.auth!.role === 'student' ? profile?.program_id || null : program || null
    const scopeSql = request.auth!.role === 'student' ? 'AND c.education_level_id = $3 AND c.grade_id IS NOT DISTINCT FROM $4::uuid AND c.program_id IS NOT DISTINCT FROM $5::uuid' : 'AND ($3::uuid IS NULL OR c.education_level_id = $3) AND ($4::uuid IS NULL OR c.grade_id = $4) AND ($5::uuid IS NULL OR c.program_id = $5)'
    const result = await pool.query(`SELECT c.id, c.title, c.description, c.difficulty, c.status, c.education_level_id, c.grade_id, c.program_id, count(l.id)::int AS lessons, s.name AS subject, u.full_name AS teacher FROM courses c JOIN subjects s ON s.id = c.subject_id JOIN users u ON u.id = c.teacher_id LEFT JOIN modules m ON m.course_id = c.id AND m.status = 'published' LEFT JOIN lessons l ON l.module_id = m.id AND l.status = 'published' WHERE c.status = 'published' AND ($1::text IS NULL OR c.title ILIKE $2 OR c.description ILIKE $2 OR s.name ILIKE $2) ${scopeSql} GROUP BY c.id, s.name, u.full_name ORDER BY c.created_at DESC`, [search || null, search ? `%${search}%` : null, effectiveLevel, effectiveGrade, effectiveProgram])
    response.json({ data: result.rows })
}))
router.get('/courses/:id', asyncHandler(async (request, response) => {
    const profile = request.auth!.role === 'student' ? await studentProfile(request.auth!.userId) : null
    if (request.auth!.role === 'student' && !profile?.education_level_id) { response.json({ data: null }); return }
    const scopeSql = request.auth!.role === 'student' ? 'AND c.education_level_id = $2 AND c.grade_id IS NOT DISTINCT FROM $3::uuid AND c.program_id IS NOT DISTINCT FROM $4::uuid' : 'AND ($2::uuid IS NULL OR c.education_level_id = $2) AND ($3::uuid IS NULL OR c.grade_id = $3) AND ($4::uuid IS NULL OR c.program_id = $4)'
    const [course, modules] = await Promise.all([
        pool.query(`SELECT c.*, s.name AS subject, u.full_name AS teacher FROM courses c JOIN subjects s ON s.id = c.subject_id JOIN users u ON u.id = c.teacher_id WHERE c.id = $1 AND c.status = 'published' ${scopeSql}`, [request.params.id, profile?.education_level_id || null, profile?.grade_id || null, profile?.program_id || null]),
        pool.query(`SELECT m.id, m.title, m.position, COALESCE(json_agg(json_build_object('id', l.id, 'title', l.title, 'content', l.content || jsonb_build_object(
            'notes', (SELECT COALESCE(json_agg(json_build_object('id', n.id, 'title', n.title, 'body', n.body) ORDER BY n.created_at), '[]') FROM lesson_notes n WHERE n.lesson_id = l.id AND n.status = 'published'),
            'examples', (SELECT COALESCE(json_agg(json_build_object('id', e.id, 'title', e.title, 'body', e.body) ORDER BY e.created_at), '[]') FROM lesson_examples e WHERE e.lesson_id = l.id AND e.status = 'published'),
            'exercises', (SELECT COALESCE(json_agg(json_build_object('id', x.id, 'prompt', x.prompt) ORDER BY x.created_at), '[]') FROM lesson_exercises x WHERE x.lesson_id = l.id AND x.status = 'published')
        ), 'durationMinutes', l.duration_minutes, 'position', l.position) ORDER BY l.position) FILTER (WHERE l.id IS NOT NULL), '[]') AS lessons FROM modules m LEFT JOIN lessons l ON l.module_id = m.id AND l.status = 'published' WHERE m.course_id = $1 AND m.status = 'published' GROUP BY m.id ORDER BY m.position`, [request.params.id]),
    ])
    response.json({ data: course.rows[0] ? { ...course.rows[0], modules: modules.rows } : null })
}))
router.use(requireAuth)
router.get('/quizzes/:id', asyncHandler(async (request, response) => {
    const owner = await pool.query('SELECT course_id FROM quizzes WHERE id = $1', [request.params.id])
    if (request.auth!.role === 'student' && (!owner.rows[0] || !(await canStudentSeeCourse(owner.rows[0].course_id, request.auth!.userId)))) { response.json({ data: null }); return }
    const result = await pool.query(`
        SELECT q.id, q.title, q.time_limit_seconds, q.course_id, q.lesson_id,
               COALESCE(json_agg(json_build_object(
                   'id', qu.id, 'type', qu.type, 'prompt', qu.prompt,
                   'explanation', qu.explanation, 'marks', qu.marks, 'position', qu.position,
                   'options', (SELECT COALESCE(json_agg(json_build_object('id', a.id, 'text', a.answer_text) ORDER BY a.id), '[]') FROM answers a WHERE a.question_id = qu.id)
               ) ORDER BY qu.position) FILTER (WHERE qu.id IS NOT NULL), '[]') AS questions
        FROM quizzes q
        LEFT JOIN questions qu ON qu.quiz_id = q.id
        WHERE q.id = $1 AND q.published = true
        GROUP BY q.id`, [request.params.id])
    response.json({ data: result.rows[0] || null })
}))
router.get('/exams/:id', asyncHandler(async (request, response) => {
    const owner = await pool.query('SELECT course_id FROM exams WHERE id = $1', [request.params.id])
    if (request.auth!.role === 'student' && (!owner.rows[0] || !(await canStudentSeeCourse(owner.rows[0].course_id, request.auth!.userId)))) { response.json({ data: null }); return }
    const result = await pool.query(`
        SELECT e.id, e.title, e.time_limit_seconds, e.course_id,
               COALESCE(json_agg(json_build_object(
                   'id', q.id, 'type', q.type, 'prompt', q.prompt,
                   'explanation', q.explanation, 'marks', q.marks, 'position', q.position,
                   'options', (SELECT COALESCE(json_agg(json_build_object('id', a.id, 'text', a.answer_text) ORDER BY a.id), '[]') FROM answers a WHERE a.question_id = q.id)
               ) ORDER BY q.position) FILTER (WHERE q.id IS NOT NULL), '[]') AS questions
        FROM exams e
        LEFT JOIN exam_questions q ON q.exam_id = e.id
        WHERE e.id = $1 AND e.published = true
        GROUP BY e.id`, [request.params.id])
    response.json({ data: result.rows[0] || null })
}))
router.get('/tests/:id', asyncHandler(async (request, response) => {
    const owner = await pool.query('SELECT course_id FROM tests WHERE id = $1', [request.params.id])
    if (request.auth!.role === 'student' && (!owner.rows[0] || !(await canStudentSeeCourse(owner.rows[0].course_id, request.auth!.userId)))) { response.json({ data: null }); return }
    const result = await pool.query(`
        SELECT t.id, t.title, t.instructions, t.time_limit_seconds, t.course_id,
               COALESCE(json_agg(json_build_object(
                   'id', q.id, 'type', q.type, 'prompt', q.prompt,
                   'explanation', q.explanation, 'marks', q.marks, 'position', q.position,
                   'options', (SELECT COALESCE(json_agg(json_build_object('id', a.id, 'text', a.answer_text) ORDER BY a.id), '[]') FROM test_answers a WHERE a.question_id = q.id)
               ) ORDER BY q.position) FILTER (WHERE q.id IS NOT NULL), '[]') AS questions
        FROM tests t
        LEFT JOIN test_questions q ON q.test_id = t.id
        WHERE t.id = $1 AND t.published = true
        GROUP BY t.id`, [request.params.id])
    response.json({ data: result.rows[0] || null })
}))
router.post('/courses/:id/enroll', asyncHandler(async (request, response) => { await pool.query('INSERT INTO enrollments (student_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [request.auth?.userId, request.params.id]); response.status(201).json({ message: 'Enrolled' }) }))
router.post('/lessons/:id/progress', asyncHandler(async (request, response) => { const input = z.object({ completed: z.boolean(), secondsSpent: z.number().int().nonnegative().max(86400) }).parse(request.body); await pool.query(`INSERT INTO progress (student_id, course_id, lesson_id, completed_at, seconds_spent) SELECT $1, m.course_id, l.id, CASE WHEN $2 THEN now() ELSE NULL END, $3 FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.id = $4 ON CONFLICT (student_id, lesson_id) DO UPDATE SET completed_at = EXCLUDED.completed_at, seconds_spent = progress.seconds_spent + EXCLUDED.seconds_spent`, [request.auth?.userId, input.completed, input.secondsSpent, request.params.id]); response.json({ message: 'Progress saved' }) }))
router.post('/subjects', requirePermission('subjects.manage'), asyncHandler(async (request, response) => { const input = z.object({ name: z.string().min(2).max(80), description: z.string().max(500).default('') }).parse(request.body); const result = await pool.query('INSERT INTO subjects (name, description, created_by) VALUES ($1, $2, $3) RETURNING id, name, description', [input.name, input.description, request.auth?.userId]); response.status(201).json({ data: result.rows[0] }) }))

export default router
