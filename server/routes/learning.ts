import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { asyncHandler } from '../errors.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'

const router = Router()
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
    const result = await pool.query(`SELECT c.id, c.title, c.description, c.difficulty, c.status, c.education_level_id, c.grade_id, c.program_id, s.name AS subject, u.full_name AS teacher FROM courses c JOIN subjects s ON s.id = c.subject_id JOIN users u ON u.id = c.teacher_id WHERE c.status = 'published' AND ($1::text IS NULL OR c.title ILIKE $2 OR c.description ILIKE $2 OR s.name ILIKE $2) AND ($3::uuid IS NULL OR c.education_level_id = $3) AND ($4::uuid IS NULL OR c.grade_id = $4) AND ($5::uuid IS NULL OR c.program_id = $5) ORDER BY c.created_at DESC`, [search || null, search ? `%${search}%` : null, level || null, grade || null, program || null])
    response.json({ data: result.rows })
}))
router.get('/courses/:id', asyncHandler(async (request, response) => {
    const [course, modules] = await Promise.all([
        pool.query('SELECT c.*, s.name AS subject, u.full_name AS teacher FROM courses c JOIN subjects s ON s.id = c.subject_id JOIN users u ON u.id = c.teacher_id WHERE c.id = $1 AND c.status = \'published\'', [request.params.id]),
        pool.query('SELECT m.id, m.title, m.position, COALESCE(json_agg(json_build_object(\'id\', l.id, \'title\', l.title, \'content\', l.content, \'durationMinutes\', l.duration_minutes, \'position\', l.position) ORDER BY l.position) FILTER (WHERE l.id IS NOT NULL), \'[]\') AS lessons FROM modules m LEFT JOIN lessons l ON l.module_id = m.id WHERE m.course_id = $1 GROUP BY m.id ORDER BY m.position', [request.params.id]),
    ])
    response.json({ data: course.rows[0] ? { ...course.rows[0], modules: modules.rows } : null })
}))
router.use(requireAuth)
router.get('/quizzes/:id', asyncHandler(async (request, response) => {
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
