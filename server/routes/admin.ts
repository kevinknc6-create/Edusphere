import { Router } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { asyncHandler, HttpError } from '../errors.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { issueTeacherVerificationCode } from './auth.js'

const router = Router()
const id = z.string().uuid()
const status = z.enum(['draft', 'pending', 'approved', 'rejected', 'published', 'archived'])
const cmsType = z.enum(['levels', 'grades', 'programs', 'subjects', 'courses', 'modules', 'lessons', 'notes', 'examples', 'exercises', 'assignments', 'quizzes', 'tests', 'exams'])
type CmsType = z.infer<typeof cmsType>

router.use(requireAuth, requirePermission('system.manage'))

async function audit(actorId: string, action: string, entityType: string, entityId: string | null, metadata: unknown = {}) {
    await pool.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5)', [actorId, action, entityType, entityId, JSON.stringify(metadata)])
}

router.get('/overview', asyncHandler(async (_request, response) => {
    const result = await pool.query(`
        SELECT
            (SELECT count(*)::int FROM users WHERE role = 'student') AS students,
            (SELECT count(*)::int FROM users WHERE role = 'teacher') AS teachers,
            (SELECT count(*)::int FROM teachers WHERE verification_status = 'pending') AS pending_teachers,
            (SELECT count(*)::int FROM courses) AS courses,
            (SELECT count(*)::int FROM subjects) AS subjects,
            (SELECT count(*)::int FROM courses WHERE status = 'draft') AS draft_courses,
            (SELECT count(*)::int FROM courses WHERE status = 'published') AS published_courses,
            (SELECT count(*)::int FROM courses WHERE status = 'archived') AS archived_courses,
            (SELECT count(*)::int FROM lessons WHERE status = 'published') AS published_lessons,
            (SELECT count(*)::int FROM audit_logs WHERE created_at >= now() - interval '30 days') AS recent_actions`)
    response.json({ data: result.rows[0] })
}))

router.get('/taxonomy', asyncHandler(async (_request, response) => {
    const [levels, grades, programs, subjects] = await Promise.all([
        pool.query('SELECT id, name, code, position FROM education_levels ORDER BY position, name'),
        pool.query('SELECT id, education_level_id, name, code, position FROM grades ORDER BY position, name'),
        pool.query('SELECT id, name, description, department_id FROM programs ORDER BY name'),
        pool.query('SELECT id, name, description, education_level_id, grade_id FROM subjects ORDER BY name'),
    ])
    response.json({ data: { levels: levels.rows, grades: grades.rows, programs: programs.rows, subjects: subjects.rows } })
}))

router.get('/users', asyncHandler(async (request, response) => {
    const search = z.string().trim().max(120).optional().parse(request.query.search)
    const result = await pool.query('SELECT id, email, full_name, role, status, created_at, last_login_at FROM users WHERE ($1::text IS NULL OR full_name ILIKE $2 OR email ILIKE $2) ORDER BY created_at DESC LIMIT 200', [search || null, search ? `%${search}%` : null])
    response.json({ data: result.rows })
}))

router.patch('/users/:id/status', asyncHandler(async (request, response) => {
    const userId = id.parse(request.params.id)
    const nextStatus = z.enum(['active', 'suspended', 'pending']).parse(request.body.status)
    const result = await pool.query('UPDATE users SET status = $1 WHERE id = $2 RETURNING id, email, full_name, role, status', [nextStatus, userId])
    if (!result.rows[0]) throw new HttpError(404, 'User not found')
    await audit(request.auth!.userId, 'user.status_changed', 'user', userId, { status: nextStatus })
    response.json({ data: result.rows[0] })
}))

router.get('/teachers', asyncHandler(async (_request, response) => {
    const result = await pool.query(`SELECT u.id, u.email, u.full_name, u.status, u.created_at, u.last_login_at, t.bio, t.teacher_verification_status, t.rejected_reason,
        COALESCE(string_agg(DISTINCT s.name, ', ' ORDER BY s.name), '') AS subjects,
        count(DISTINCT c.id)::int AS courses,
        COALESCE(array_agg(DISTINCT tp.permission) FILTER (WHERE tp.permission IS NOT NULL), '{}') AS permissions
        FROM users u JOIN teachers t ON t.user_id = u.id LEFT JOIN subject_teachers st ON st.teacher_id = u.id LEFT JOIN subjects s ON s.id = st.subject_id LEFT JOIN courses c ON c.teacher_id = u.id LEFT JOIN teacher_permissions tp ON tp.teacher_id = u.id
        WHERE u.role = 'teacher' GROUP BY u.id, t.teacher_verification_status, t.rejected_reason, t.bio ORDER BY u.full_name`)
    response.json({ data: result.rows })
}))

router.post('/teachers', asyncHandler(async (request, response) => {
    const input = z.object({ email: z.string().trim().email().transform((value) => value.toLowerCase()), fullName: z.string().trim().min(2).max(120), bio: z.string().max(4000).default('') }).parse(request.body)
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('base64url'), 12)
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const user = await client.query(`INSERT INTO users (email, password_hash, full_name, role, status, email_verified_at) VALUES ($1, $2, $3, 'teacher', 'pending', NULL) RETURNING id, email, full_name, role, status, created_at`, [input.email, passwordHash, input.fullName])
        await client.query('INSERT INTO teachers (user_id, bio, verification_status, teacher_verification_status) VALUES ($1, $2, \'pending\', \'pending\')', [user.rows[0].id, input.bio])
        await client.query('COMMIT')
        await audit(request.auth!.userId, 'teacher.created', 'teacher', user.rows[0].id, { email: input.email })
        response.status(201).json({ data: user.rows[0] })
    } catch (error) { await client.query('ROLLBACK'); if ((error as { code?: string }).code === '23505') throw new HttpError(409, 'A user with that email already exists'); throw error } finally { client.release() }
}))

async function updateTeacherStatus(actorId: string, teacherId: string, nextStatus: 'pending' | 'approved' | 'verified' | 'suspended' | 'rejected') {
    const userStatus = nextStatus === 'suspended' || nextStatus === 'rejected' || nextStatus === 'pending' ? 'suspended' : 'active'
    const result = await pool.query(`UPDATE teachers SET teacher_verification_status = $1, verification_status = $2, approved_by = CASE WHEN $1 IN ('approved', 'verified') THEN $3 ELSE approved_by END, approved_at = CASE WHEN $1 IN ('approved', 'verified') THEN COALESCE(approved_at, now()) ELSE approved_at END, rejected_reason = CASE WHEN $1 = 'rejected' THEN rejected_reason ELSE NULL END WHERE user_id = $4 RETURNING user_id, teacher_verification_status`, [nextStatus, userStatus === 'active' ? 'active' : userStatus === 'suspended' ? 'suspended' : 'pending', actorId, teacherId])
    if (!result.rows[0]) throw new HttpError(404, 'Teacher not found')
    await pool.query('UPDATE users SET status = $1 WHERE id = $2', [userStatus, teacherId])
    await pool.query('UPDATE teacher_verification_codes SET invalidated_at = now() WHERE teacher_id = $1 AND consumed_at IS NULL AND invalidated_at IS NULL', [teacherId])
    await audit(actorId, `teacher.${nextStatus}`, 'teacher', teacherId)
    if (nextStatus === 'approved' || nextStatus === 'verified') await issueTeacherVerificationCode(teacherId, actorId)
    return result.rows[0]
}

router.patch('/teachers/:id/status', asyncHandler(async (request, response) => {
    const teacherId = id.parse(request.params.id)
    const nextStatus = z.enum(['pending', 'approved', 'verified', 'suspended', 'rejected']).parse(request.body.status)
    response.json({ data: await updateTeacherStatus(request.auth!.userId, teacherId, nextStatus) })
}))

router.post('/teachers/:id/resend-verification', asyncHandler(async (request, response) => {
    const teacherId = id.parse(request.params.id)
    await issueTeacherVerificationCode(teacherId, request.auth!.userId)
    await audit(request.auth!.userId, 'teacher.verification_resent', 'teacher', teacherId)
    response.json({ message: 'A new verification code was sent to the approved teacher email.' })
}))

router.patch('/teachers/:id/verification', asyncHandler(async (request, response) => {
    const teacherId = id.parse(request.params.id)
    const verification = z.enum(['pending', 'approved', 'verified', 'suspended', 'rejected']).parse(request.body.status)
    response.json({ data: await updateTeacherStatus(request.auth!.userId, teacherId, verification) })
}))

router.put('/teachers/:id/permissions', asyncHandler(async (request, response) => {
    const teacherId = id.parse(request.params.id)
    const permissions = z.array(z.string().trim().min(1).max(80)).max(30).parse(request.body.permissions)
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        await client.query('DELETE FROM teacher_permissions WHERE teacher_id = $1', [teacherId])
        for (const permission of permissions) await client.query('INSERT INTO teacher_permissions (teacher_id, permission, granted_by) VALUES ($1, $2, $3)', [teacherId, permission, request.auth!.userId])
        await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    await audit(request.auth!.userId, 'teacher.permissions_changed', 'teacher', teacherId, { permissions })
    response.json({ data: { teacherId, permissions } })
}))

const listQueries: Record<CmsType, string> = {
    levels: 'SELECT id, name, code, position, created_at FROM education_levels ORDER BY position, name',
    grades: 'SELECT g.id, g.name, g.code, g.position, g.education_level_id, el.name AS education_level_name FROM grades g JOIN education_levels el ON el.id = g.education_level_id ORDER BY el.position, g.position, g.name',
    programs: 'SELECT id, name, description, department_id FROM programs ORDER BY name',
    subjects: 'SELECT id, name, description, education_level_id, grade_id, created_at FROM subjects ORDER BY name',
    courses: `SELECT c.id, c.title, c.description, c.difficulty, c.status, c.subject_id, c.education_level_id, c.grade_id, c.program_id, s.name AS subject, u.full_name AS teacher, c.created_at, c.updated_at FROM courses c JOIN subjects s ON s.id = c.subject_id JOIN users u ON u.id = c.teacher_id ORDER BY c.updated_at DESC`,
    modules: 'SELECT m.id, m.course_id, m.title, m.position, m.status, c.title AS course FROM modules m JOIN courses c ON c.id = m.course_id ORDER BY c.title, m.position',
    lessons: 'SELECT l.id, l.module_id, l.title, l.content, l.duration_minutes, l.position, l.status, m.title AS module, c.id AS course_id, c.title AS course FROM lessons l JOIN modules m ON m.id = l.module_id JOIN courses c ON c.id = m.course_id ORDER BY c.title, m.position, l.position',
    notes: 'SELECT n.id, n.lesson_id, n.title, n.body, n.status, l.title AS lesson FROM lesson_notes n JOIN lessons l ON l.id = n.lesson_id ORDER BY n.updated_at DESC',
    examples: 'SELECT e.id, e.lesson_id, e.title, e.body, e.status, l.title AS lesson FROM lesson_examples e JOIN lessons l ON l.id = e.lesson_id ORDER BY e.updated_at DESC',
    exercises: 'SELECT e.id, e.lesson_id, e.prompt, e.answer, e.status, l.title AS lesson FROM lesson_exercises e JOIN lessons l ON l.id = e.lesson_id ORDER BY e.updated_at DESC',
    assignments: 'SELECT a.id, a.course_id, a.title, a.instructions, a.due_at, a.total_marks, a.status, c.title AS course FROM assignments a JOIN courses c ON c.id = a.course_id ORDER BY a.due_at',
    quizzes: 'SELECT q.id, q.course_id, q.lesson_id, q.title, q.time_limit_seconds, q.status, c.title AS course FROM quizzes q JOIN courses c ON c.id = q.course_id ORDER BY q.title',
    tests: 'SELECT t.id, t.course_id, t.title, t.instructions, t.time_limit_seconds, t.status, c.title AS course FROM tests t JOIN courses c ON c.id = t.course_id ORDER BY t.title',
    exams: 'SELECT e.id, e.course_id, e.title, e.time_limit_seconds, e.status, c.title AS course FROM exams e JOIN courses c ON c.id = e.course_id ORDER BY e.title',
}

router.get('/content/:type', asyncHandler(async (request, response) => {
    const type = cmsType.parse(request.params.type)
    const result = await pool.query(listQueries[type])
    response.json({ data: result.rows })
}))

router.post('/content/:type', asyncHandler(async (request, response) => {
    const type = cmsType.parse(request.params.type)
    const body = request.body as Record<string, unknown>
    let result
    if (type === 'levels') result = await pool.query('INSERT INTO education_levels (name, code, position) VALUES ($1, $2, $3) RETURNING *', [z.string().min(1).max(120).parse(body.name), z.string().min(1).max(40).parse(body.code), z.coerce.number().int().default(0).parse(body.position)])
    else if (type === 'grades') result = await pool.query('INSERT INTO grades (education_level_id, name, code, position) VALUES ($1, $2, $3, $4) RETURNING *', [id.parse(body.educationLevelId), z.string().min(1).max(120).parse(body.name), z.string().min(1).max(40).parse(body.code), z.coerce.number().int().default(0).parse(body.position)])
    else if (type === 'programs') result = await pool.query('INSERT INTO programs (name, description, department_id) VALUES ($1, $2, $3) RETURNING *', [z.string().min(1).max(160).parse(body.name), z.string().max(2000).default('').parse(body.description), body.departmentId ? id.parse(body.departmentId) : null])
    else if (type === 'subjects') result = await pool.query('INSERT INTO subjects (name, description, education_level_id, grade_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *', [z.string().min(1).max(120).parse(body.name), z.string().max(2000).default('').parse(body.description), body.educationLevelId ? id.parse(body.educationLevelId) : null, body.gradeId ? id.parse(body.gradeId) : null, request.auth!.userId])
    else if (type === 'courses') result = await pool.query('INSERT INTO courses (teacher_id, subject_id, title, description, difficulty, status, education_level_id, grade_id, program_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *', [id.parse(body.teacherId), id.parse(body.subjectId), z.string().min(1).max(160).parse(body.title), z.string().max(4000).default('').parse(body.description), z.string().max(80).default('Beginner').parse(body.difficulty), status.default('draft').parse(body.status), body.educationLevelId ? id.parse(body.educationLevelId) : null, body.gradeId ? id.parse(body.gradeId) : null, body.programId ? id.parse(body.programId) : null])
    else if (type === 'modules') result = await pool.query('INSERT INTO modules (course_id, title, position, status) VALUES ($1, $2, $3, $4) RETURNING *', [id.parse(body.courseId), z.string().min(1).max(160).parse(body.title), z.coerce.number().int().nonnegative().default(0).parse(body.position), status.default('draft').parse(body.status)])
    else if (type === 'lessons') result = await pool.query('INSERT INTO lessons (module_id, title, content, duration_minutes, position, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *', [id.parse(body.moduleId), z.string().min(1).max(160).parse(body.title), JSON.stringify(body.content || {}), z.coerce.number().int().positive().default(1).parse(body.durationMinutes), z.coerce.number().int().nonnegative().default(0).parse(body.position), status.default('draft').parse(body.status), request.auth!.userId])
    else if (type === 'notes') result = await pool.query('INSERT INTO lesson_notes (lesson_id, title, body, status, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *', [id.parse(body.lessonId), z.string().max(240).default('').parse(body.title), z.string().min(1).parse(body.body), status.default('draft').parse(body.status), request.auth!.userId])
    else if (type === 'examples') result = await pool.query('INSERT INTO lesson_examples (lesson_id, title, body, status, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *', [id.parse(body.lessonId), z.string().max(240).default('').parse(body.title), z.string().min(1).parse(body.body), status.default('draft').parse(body.status), request.auth!.userId])
    else if (type === 'exercises') result = await pool.query('INSERT INTO lesson_exercises (lesson_id, prompt, answer, status, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *', [id.parse(body.lessonId), z.string().min(1).parse(body.prompt), z.string().max(4000).default('').parse(body.answer), status.default('draft').parse(body.status), request.auth!.userId])
    else if (type === 'assignments') result = await pool.query('INSERT INTO assignments (course_id, teacher_id, title, instructions, due_at, total_marks, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *', [id.parse(body.courseId), id.parse(body.teacherId), z.string().min(1).max(160).parse(body.title), z.string().min(1).max(10000).parse(body.instructions), z.string().datetime().parse(body.dueAt), z.coerce.number().int().positive().default(100).parse(body.totalMarks), status.default('draft').parse(body.status)])
    else if (type === 'quizzes') result = await pool.query('INSERT INTO quizzes (course_id, lesson_id, title, time_limit_seconds, status, published) VALUES ($1, $2, $3, $4, $5, false) RETURNING *', [id.parse(body.courseId), body.lessonId ? id.parse(body.lessonId) : null, z.string().min(1).max(160).parse(body.title), body.timeLimitSeconds ? z.coerce.number().int().positive().parse(body.timeLimitSeconds) : null, status.default('draft').parse(body.status)])
    else if (type === 'tests') result = await pool.query('INSERT INTO tests (course_id, title, instructions, time_limit_seconds, status, published) VALUES ($1, $2, $3, $4, $5, false) RETURNING *', [id.parse(body.courseId), z.string().min(1).max(160).parse(body.title), z.string().max(10000).default('').parse(body.instructions), body.timeLimitSeconds ? z.coerce.number().int().positive().parse(body.timeLimitSeconds) : null, status.default('draft').parse(body.status)])
    else if (type === 'exams') result = await pool.query('INSERT INTO exams (course_id, title, time_limit_seconds, status, published) VALUES ($1, $2, $3, $4, false) RETURNING *', [id.parse(body.courseId), z.string().min(1).max(160).parse(body.title), z.coerce.number().int().positive().default(60).parse(body.timeLimitSeconds), status.default('draft').parse(body.status)])
    if (!result) throw new HttpError(400, 'Content could not be created')
    await audit(request.auth!.userId, 'content.created', type, result.rows[0].id, { type })
    response.status(201).json({ data: result.rows[0] })
}))

router.patch('/content/:type/:contentId', asyncHandler(async (request, response) => {
    const type = cmsType.parse(request.params.type)
    const contentId = id.parse(request.params.contentId)
    const body = request.body as Record<string, unknown>
    const tables: Record<CmsType, string> = { levels: 'education_levels', grades: 'grades', programs: 'programs', subjects: 'subjects', courses: 'courses', modules: 'modules', lessons: 'lessons', notes: 'lesson_notes', examples: 'lesson_examples', exercises: 'lesson_exercises', assignments: 'assignments', quizzes: 'quizzes', tests: 'tests', exams: 'exams' }
    const allowed: Record<string, string> = { name: 'name', code: 'code', position: 'position', description: 'description', title: 'title', body: 'body', prompt: 'prompt', answer: 'answer', content: 'content', difficulty: 'difficulty', instructions: 'instructions', durationMinutes: 'duration_minutes', timeLimitSeconds: 'time_limit_seconds', educationLevelId: 'education_level_id', gradeId: 'grade_id', programId: 'program_id', subjectId: 'subject_id', courseId: 'course_id', moduleId: 'module_id', lessonId: 'lesson_id' }
    const fields: string[] = []
    const values: unknown[] = []
    for (const [key, column] of Object.entries(allowed)) {
        if (!(key in body)) continue
        let value = body[key]
        if (['educationLevelId', 'gradeId', 'programId', 'subjectId', 'courseId', 'moduleId', 'lessonId'].includes(key)) value = value ? id.parse(value) : null
        if (key === 'content') value = JSON.stringify(value || {})
        fields.push(`${column} = $${values.length + 1}`)
        values.push(value)
    }
    const supportsStatus = !['levels', 'grades', 'programs', 'subjects'].includes(type)
    if (supportsStatus && 'status' in body) { fields.push(`status = $${values.length + 1}`); values.push(status.parse(body.status)) }
    if (!fields.length) throw new HttpError(400, 'No editable fields supplied')
    values.push(contentId)
    const result = await pool.query(`UPDATE ${tables[type]} SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`, values)
    if (!result.rows[0]) throw new HttpError(404, 'Content not found')
    await audit(request.auth!.userId, 'content.updated', type, contentId, { fields: fields.map((field) => field.split(' = ')[0]) })
    response.json({ data: result.rows[0] })
}))

const assessmentConfig = {
    quizzes: { table: 'questions', answerTable: 'answers', owner: 'quiz_id', parent: 'quizzes' },
    tests: { table: 'test_questions', answerTable: 'test_answers', owner: 'test_id', parent: 'tests' },
    exams: { table: 'exam_questions', answerTable: 'exam_answers', owner: 'exam_id', parent: 'exams' },
} as const

router.post('/content/:type/:contentId/questions', asyncHandler(async (request, response) => {
    const type = z.enum(['quizzes', 'tests', 'exams']).parse(request.params.type)
    const contentId = id.parse(request.params.contentId)
    const config = assessmentConfig[type]
    const input = z.object({ type: z.enum(['multiple-choice', 'true-false', 'fill-blank', 'matching', 'short-answer', 'programming']), prompt: z.string().min(1).max(4000), explanation: z.string().max(4000).default(''), marks: z.number().int().positive().default(1), position: z.number().int().nonnegative().optional(), options: z.array(z.object({ text: z.string().min(1).max(500), correct: z.boolean().default(false) })).default([]) }).parse(request.body)
    const owner = await pool.query(`SELECT id FROM ${config.parent} WHERE id = $1`, [contentId])
    if (!owner.rows[0]) throw new HttpError(404, 'Assessment not found')
    const question = await pool.query(`INSERT INTO ${config.table} (${config.owner}, type, prompt, explanation, marks, position) VALUES ($1, $2, $3, $4, $5, COALESCE($6, (SELECT COALESCE(max(position), -1) + 1 FROM ${config.table} WHERE ${config.owner} = $1))) RETURNING *`, [contentId, input.type, input.prompt, input.explanation, input.marks, input.position ?? null])
    for (const option of input.options) await pool.query(`INSERT INTO ${config.answerTable} (question_id, answer_text, is_correct) VALUES ($1, $2, $3)`, [question.rows[0].id, option.text, option.correct])
    await audit(request.auth!.userId, 'question.created', type, question.rows[0].id)
    response.status(201).json({ data: question.rows[0] })
}))

router.get('/content/:type/:contentId/questions', asyncHandler(async (request, response) => {
    const type = z.enum(['quizzes', 'tests', 'exams']).parse(request.params.type)
    const config = assessmentConfig[type]
    const result = await pool.query(`SELECT q.*, COALESCE(json_agg(json_build_object('id', a.id, 'text', a.answer_text, 'correct', a.is_correct) ORDER BY a.id) FILTER (WHERE a.id IS NOT NULL), '[]') AS answers FROM ${config.table} q LEFT JOIN ${config.answerTable} a ON a.question_id = q.id WHERE q.${config.owner} = $1 GROUP BY q.id ORDER BY q.position`, [id.parse(request.params.contentId)])
    response.json({ data: result.rows })
}))

router.patch('/content/:type/:contentId/status', asyncHandler(async (request, response) => {
    const type = cmsType.parse(request.params.type)
    const contentId = id.parse(request.params.contentId)
    const nextStatus = status.parse(request.body.status)
    if (['levels', 'grades', 'programs', 'subjects'].includes(type)) throw new HttpError(400, 'This item has no publishing workflow')
    const table = { levels: 'education_levels', grades: 'grades', programs: 'programs', subjects: 'subjects', courses: 'courses', modules: 'modules', lessons: 'lessons', notes: 'lesson_notes', examples: 'lesson_examples', exercises: 'lesson_exercises', assignments: 'assignments', quizzes: 'quizzes', tests: 'tests', exams: 'exams' }[type]
    const result = await pool.query(`UPDATE ${table} SET status = $1 WHERE id = $2 RETURNING *`, [nextStatus, contentId])
    if (!result.rows[0]) throw new HttpError(404, 'Content not found')
    if (['quizzes', 'tests', 'exams'].includes(type)) await pool.query(`UPDATE ${table} SET published = $1 WHERE id = $2`, [nextStatus === 'published', contentId])
    if (type === 'courses') await pool.query('UPDATE courses SET published_at = CASE WHEN $1 = \'published\' THEN now() ELSE published_at END WHERE id = $2', [nextStatus, contentId])
    if (type === 'assignments') await pool.query('UPDATE assignments SET published_at = CASE WHEN $1 = \'published\' THEN now() ELSE published_at END WHERE id = $2', [nextStatus, contentId])
    await audit(request.auth!.userId, `content.${nextStatus}`, type, contentId)
    response.json({ data: result.rows[0] })
}))

router.delete('/content/:type/:contentId', asyncHandler(async (request, response) => {
    const type = cmsType.parse(request.params.type)
    const contentId = id.parse(request.params.contentId)
    const table = { levels: 'education_levels', grades: 'grades', programs: 'programs', subjects: 'subjects', courses: 'courses', modules: 'modules', lessons: 'lessons', notes: 'lesson_notes', examples: 'lesson_examples', exercises: 'lesson_exercises', assignments: 'assignments', quizzes: 'quizzes', tests: 'tests', exams: 'exams' }[type]
    const result = await pool.query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [contentId])
    if (!result.rows[0]) throw new HttpError(404, 'Content not found')
    await audit(request.auth!.userId, 'content.deleted', type, contentId)
    response.status(204).send()
}))

router.get('/audit-logs', requirePermission('audit.view'), asyncHandler(async (_request, response) => {
    const result = await pool.query('SELECT id, actor_id, action, entity_type, entity_id, metadata, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 200')
    response.json({ data: result.rows })
}))

export default router