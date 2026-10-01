import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { asyncHandler, HttpError } from '../errors.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

async function scoreAssessment(questionTable: 'questions' | 'exam_questions' | 'test_questions', answerTable: 'answers' | 'exam_answers' | 'test_answers', ownerColumn: 'quiz_id' | 'exam_id' | 'test_id', ownerId: string, answers: Record<string, string>) {
    const result = await pool.query(`SELECT q.id, q.explanation, a.id AS answer_id, a.answer_text, a.is_correct FROM ${questionTable} q LEFT JOIN ${answerTable} a ON a.question_id = q.id WHERE q.${ownerColumn} = $1 ORDER BY q.position, a.id`, [ownerId])
    const questions = new Map<string, { explanation: string; correct: string[]; options: Array<{ id: string; text: string }> }>()
    for (const row of result.rows) {
        const current = questions.get(row.id) || { explanation: row.explanation, correct: [] as string[], options: [] as Array<{ id: string; text: string }> }
        if (row.answer_id) { current.options.push({ id: row.answer_id, text: row.answer_text }); if (row.is_correct) current.correct.push(row.answer_id) }
        questions.set(row.id, current)
    }
    let correct = 0
    const review = [...questions.entries()].map(([id, question]) => {
        const submitted = answers[id] || ''
        const isCorrect = question.correct.includes(submitted) || question.options.some((option) => question.correct.includes(option.id) && option.text.toLowerCase() === submitted.trim().toLowerCase())
        if (isCorrect) correct += 1
        return { questionId: id, submitted, isCorrect, explanation: question.explanation }
    })
    return { score: questions.size ? Math.round(correct / questions.size * 100) : 0, review }
}

router.get('/me/education-profile', asyncHandler(async (request, response) => {
    const result = await pool.query(`
		SELECT s.education_level_id, s.grade_id, s.program_id,
			   el.name AS education_level_name, el.code AS education_level_code,
			   g.name AS grade_name, g.code AS grade_code,
			   p.name AS program_name
		FROM students s
		LEFT JOIN education_levels el ON el.id = s.education_level_id
		LEFT JOIN grades g ON g.id = s.grade_id
		LEFT JOIN programs p ON p.id = s.program_id
		WHERE s.user_id = $1`, [request.auth?.userId])
    response.json({ data: result.rows[0] || null })
}))

router.patch('/me/education-profile', asyncHandler(async (request, response) => {
    const input = z.object({
        educationLevelId: z.string().uuid(),
        gradeId: z.string().uuid().nullable().optional(),
        programId: z.string().uuid().nullable().optional(),
    }).parse(request.body)
    const gradeId = input.gradeId || null
    const programId = input.programId || null
    const level = await pool.query('SELECT id, name FROM education_levels WHERE id = $1', [input.educationLevelId])
    if (!level.rows[0]) throw new HttpError(400, 'The selected education level is not available')
    if (gradeId) {
        const grade = await pool.query('SELECT id, name FROM grades WHERE id = $1 AND education_level_id = $2', [gradeId, input.educationLevelId])
        if (!grade.rows[0]) throw new HttpError(400, 'The selected grade does not belong to that education level')
    }
    if (programId) {
        const program = await pool.query('SELECT id, name FROM programs WHERE id = $1', [programId])
        if (!program.rows[0]) throw new HttpError(400, 'The selected program is not available')
    }
    const result = await pool.query(`
		UPDATE students
		SET education_level_id = $1,
			grade_id = $2,
			program_id = $3,
			education_level = $4,
			school_class = $5
		WHERE user_id = $6
		RETURNING education_level_id, grade_id, program_id`, [input.educationLevelId, gradeId, programId, level.rows[0].name, gradeId || null, request.auth?.userId])
    response.json({ data: result.rows[0] })
}))

async function curriculumDashboard(userId: string) {
    const profileResult = await pool.query(`SELECT s.education_level_id, s.grade_id, s.program_id, el.name AS education_level_name, g.name AS grade_name, p.name AS program_name
        FROM students s LEFT JOIN education_levels el ON el.id = s.education_level_id LEFT JOIN grades g ON g.id = s.grade_id LEFT JOIN programs p ON p.id = s.program_id WHERE s.user_id = $1`, [userId])
    const profile = profileResult.rows[0] || null
    if (!profile?.education_level_id) return { profile, curriculum: [], subjects: [], courses: [], modules: [], lessons: [], notes: [], examples: [], exercises: [], quizzes: [], tests: [], exams: [], homework: [], results: [], progress: [] }
    const scope = [profile.education_level_id, profile.grade_id, profile.program_id]
    const courseScope = `c.status = 'published' AND c.education_level_id = $1 AND c.grade_id IS NOT DISTINCT FROM $2::uuid AND c.program_id IS NOT DISTINCT FROM $3::uuid`
    const [courses, subjects, modules, lessons, notes, examples, exercises, quizzes, tests, exams, homework, progress] = await Promise.all([
        pool.query(`SELECT c.id, c.title, c.description, c.difficulty, c.education_level_id, c.grade_id, c.program_id, s.name AS subject, u.full_name AS teacher, count(l.id)::int AS lessons FROM courses c JOIN subjects s ON s.id = c.subject_id JOIN users u ON u.id = c.teacher_id LEFT JOIN modules m ON m.course_id = c.id AND m.status = 'published' LEFT JOIN lessons l ON l.module_id = m.id AND l.status = 'published' WHERE ${courseScope} GROUP BY c.id, s.name, u.full_name ORDER BY c.created_at DESC`, scope),
        pool.query(`SELECT DISTINCT s.id, s.name, s.description FROM subjects s JOIN courses c ON c.subject_id = s.id WHERE ${courseScope} ORDER BY s.name`, scope),
        pool.query(`SELECT m.id, m.course_id, m.title, m.position FROM modules m JOIN courses c ON c.id = m.course_id WHERE ${courseScope} AND m.status = 'published' ORDER BY m.position`, scope),
        pool.query(`SELECT l.id, l.module_id, l.title, l.content, l.duration_minutes, l.position FROM lessons l JOIN modules m ON m.id = l.module_id JOIN courses c ON c.id = m.course_id WHERE ${courseScope} AND m.status = 'published' AND l.status = 'published' ORDER BY l.position`, scope),
        pool.query(`SELECT n.id, n.lesson_id, n.title, n.body FROM lesson_notes n JOIN lessons l ON l.id = n.lesson_id JOIN modules m ON m.id = l.module_id JOIN courses c ON c.id = m.course_id WHERE ${courseScope} AND n.status = 'published'`, scope),
        pool.query(`SELECT e.id, e.lesson_id, e.title, e.body FROM lesson_examples e JOIN lessons l ON l.id = e.lesson_id JOIN modules m ON m.id = l.module_id JOIN courses c ON c.id = m.course_id WHERE ${courseScope} AND e.status = 'published'`, scope),
        pool.query(`SELECT e.id, e.lesson_id, e.prompt FROM lesson_exercises e JOIN lessons l ON l.id = e.lesson_id JOIN modules m ON m.id = l.module_id JOIN courses c ON c.id = m.course_id WHERE ${courseScope} AND e.status = 'published'`, scope),
        pool.query(`SELECT q.id, q.course_id, q.lesson_id, q.title, q.time_limit_seconds FROM quizzes q JOIN courses c ON c.id = q.course_id WHERE ${courseScope} AND q.status = 'published' AND q.published = true`, scope),
        pool.query(`SELECT t.id, t.course_id, t.title, t.instructions, t.time_limit_seconds FROM tests t JOIN courses c ON c.id = t.course_id WHERE ${courseScope} AND t.status = 'published' AND t.published = true`, scope),
        pool.query(`SELECT e.id, e.course_id, e.title, e.time_limit_seconds FROM exams e JOIN courses c ON c.id = e.course_id WHERE ${courseScope} AND e.status = 'published' AND e.published = true`, scope),
        pool.query(`SELECT a.id, a.course_id, a.title, a.instructions, a.due_at, a.total_marks FROM assignments a JOIN courses c ON c.id = a.course_id WHERE ${courseScope} AND a.status = 'published' ORDER BY a.due_at`, scope),
        pool.query(`SELECT p.course_id, p.lesson_id, p.completed_at, p.seconds_spent FROM progress p JOIN courses c ON c.id = p.course_id WHERE p.student_id = $4 AND ${courseScope}`, [...scope, userId]),
    ])
    return { profile, curriculum: [], subjects: subjects.rows, courses: courses.rows, modules: modules.rows, lessons: lessons.rows, notes: notes.rows, examples: examples.rows, exercises: exercises.rows, quizzes: quizzes.rows, tests: tests.rows, exams: exams.rows, homework: homework.rows, results: [], progress: progress.rows }
}

async function studentCanAccessCourse(userId: string, courseId: string) {
    const result = await pool.query(`SELECT 1 FROM courses c JOIN students sp ON sp.user_id = $2 WHERE c.id = $1 AND c.status = 'published' AND c.education_level_id = sp.education_level_id AND c.grade_id IS NOT DISTINCT FROM sp.grade_id AND c.program_id IS NOT DISTINCT FROM sp.program_id`, [courseId, userId])
    return Boolean(result.rows[0])
}

async function requirePublishedActivity(userId: string, table: 'quizzes' | 'tests' | 'exams' | 'assignments', activityId: string) {
    const visibility = table === 'assignments' ? `status = 'published'` : `status = 'published' AND published = true`
    const result = await pool.query(`SELECT course_id FROM ${table} WHERE id = $1 AND ${visibility}`, [activityId])
    if (!result.rows[0] || !(await studentCanAccessCourse(userId, result.rows[0].course_id))) throw new HttpError(404, 'Published activity not found')
}

router.get('/me/learning-dashboard', asyncHandler(async (request, response) => { response.json({ data: await curriculumDashboard(request.auth!.userId) }) }))
router.get('/me/tvet-dashboard', asyncHandler(async (request, response) => { response.json({ data: await curriculumDashboard(request.auth!.userId) }) }))
router.get('/me/university-dashboard', asyncHandler(async (request, response) => { response.json({ data: await curriculumDashboard(request.auth!.userId) }) }))

router.get('/me/learning-summary', asyncHandler(async (request, response) => {
    const studentId = request.auth?.userId
    const [profile, courses, scores, homework, activity, achievements] = await Promise.all([
        pool.query(`SELECT s.education_level_id, s.grade_id, s.program_id, el.name AS education_level_name, g.name AS grade_name, p.name AS program_name FROM students s LEFT JOIN education_levels el ON el.id = s.education_level_id LEFT JOIN grades g ON g.id = s.grade_id LEFT JOIN programs p ON p.id = s.program_id WHERE s.user_id = $1`, [studentId]),
        pool.query(`SELECT c.id, c.title, s.name AS subject, c.education_level_id, c.grade_id, c.program_id, count(l.id)::int AS total_lessons, count(pr.completed_at)::int AS completed_lessons, COALESCE(sum(pr.seconds_spent), 0)::int AS seconds_spent FROM enrollments e JOIN courses c ON c.id = e.course_id JOIN subjects s ON s.id = c.subject_id LEFT JOIN modules m ON m.course_id = c.id LEFT JOIN lessons l ON l.module_id = m.id LEFT JOIN progress pr ON pr.lesson_id = l.id AND pr.student_id = e.student_id WHERE e.student_id = $1 GROUP BY c.id, s.name ORDER BY c.updated_at DESC`, [studentId]),
        pool.query(`SELECT 'quiz' AS type, COALESCE(avg(score), 0)::numeric(5,2) AS average_score, count(*)::int AS attempts FROM quiz_attempts WHERE student_id = $1 UNION ALL SELECT 'test', COALESCE(avg(score), 0)::numeric(5,2), count(*)::int FROM test_attempts WHERE student_id = $1 UNION ALL SELECT 'exam', COALESCE(avg(score), 0)::numeric(5,2), count(*)::int FROM exam_attempts WHERE student_id = $1`, [studentId]),
        pool.query(`SELECT a.id, a.course_id, a.title, a.due_at, CASE WHEN s.id IS NULL THEN 'pending' WHEN s.score IS NULL THEN 'submitted' ELSE 'graded' END AS status, s.score FROM assignments a JOIN courses c ON c.id = a.course_id JOIN students sp ON sp.user_id = $1 LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = $1 WHERE a.status = 'published' AND c.status = 'published' AND c.education_level_id = sp.education_level_id AND c.grade_id IS NOT DISTINCT FROM sp.grade_id AND c.program_id IS NOT DISTINCT FROM sp.program_id ORDER BY a.due_at LIMIT 20`, [studentId]),
        pool.query(`SELECT activity_type, title, occurred_at FROM (SELECT 'lesson' AS activity_type, l.title, pr.completed_at AS occurred_at FROM progress pr JOIN lessons l ON l.id = pr.lesson_id WHERE pr.student_id = $1 AND pr.completed_at IS NOT NULL UNION ALL SELECT 'quiz', q.title, qa.submitted_at FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id WHERE qa.student_id = $1 UNION ALL SELECT 'test', t.title, ta.submitted_at FROM test_attempts ta JOIN tests t ON t.id = ta.test_id WHERE ta.student_id = $1 UNION ALL SELECT 'exam', e.title, ea.submitted_at FROM exam_attempts ea JOIN exams e ON e.id = ea.exam_id WHERE ea.student_id = $1) activity ORDER BY occurred_at DESC LIMIT 20`, [studentId]),
        pool.query(`SELECT a.key, a.name, a.description, sa.earned_at FROM student_achievements sa JOIN achievements a ON a.id = sa.achievement_id WHERE sa.student_id = $1 ORDER BY sa.earned_at DESC`, [studentId]),
    ])
    const courseRows = courses.rows.map((course) => ({ ...course, progress: course.total_lessons ? Math.round(course.completed_lessons / course.total_lessons * 100) : 0 }))
    const completedDates = new Set(activity.rows.filter((item) => item.activity_type === 'lesson').map((item) => new Date(item.occurred_at).toISOString().slice(0, 10)))
    let streak = 0
    const cursor = new Date()
    while (completedDates.has(cursor.toISOString().slice(0, 10))) { streak += 1; cursor.setDate(cursor.getDate() - 1) }
    response.json({ data: { profile: profile.rows[0] || null, coursesStarted: courseRows.length, coursesCompleted: courseRows.filter((course) => course.progress >= 100).length, lessonsCompleted: courseRows.reduce((total, course) => total + course.completed_lessons, 0), overallProgress: courseRows.length ? Math.round(courseRows.reduce((total, course) => total + course.progress, 0) / courseRows.length) : 0, courses: courseRows, scores: scores.rows, homework: homework.rows, recentActivity: activity.rows, learningStreak: streak, achievements: achievements.rows } })
}))

router.put('/bookmarks/:lessonId', asyncHandler(async (request, response) => { await pool.query('INSERT INTO bookmarks (student_id, lesson_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [request.auth?.userId, request.params.lessonId]); response.status(204).send() }))
router.delete('/bookmarks/:lessonId', asyncHandler(async (request, response) => { await pool.query('DELETE FROM bookmarks WHERE student_id = $1 AND lesson_id = $2', [request.auth?.userId, request.params.lessonId]); response.status(204).send() }))
router.get('/notes/:lessonId', asyncHandler(async (request, response) => { const result = await pool.query('SELECT id, lesson_id, body, updated_at FROM notes WHERE student_id = $1 AND lesson_id = $2', [request.auth?.userId, request.params.lessonId]); response.json({ data: result.rows[0] || null }) }))
router.put('/notes/:lessonId', asyncHandler(async (request, response) => { const body = z.string().min(1).max(20_000).parse(request.body.body); const result = await pool.query('INSERT INTO notes (student_id, lesson_id, body) VALUES ($1, $2, $3) ON CONFLICT (student_id, lesson_id) DO UPDATE SET body = EXCLUDED.body, updated_at = now() RETURNING id, lesson_id, body, updated_at', [request.auth?.userId, request.params.lessonId, body]); response.json({ data: result.rows[0] }) }))
router.post('/quizzes/:quizId/attempts', asyncHandler(async (request, response) => { const answers = z.record(z.string(), z.string()).parse(request.body.answers); const quizId = String(request.params.quizId); await requirePublishedActivity(request.auth!.userId, 'quizzes', quizId); const evaluated = await scoreAssessment('questions', 'answers', 'quiz_id', quizId, answers); const result = await pool.query('INSERT INTO quiz_attempts (quiz_id, student_id, answers, score) VALUES ($1, $2, $3, $4) RETURNING id, score, submitted_at', [quizId, request.auth?.userId, JSON.stringify(answers), evaluated.score]); response.status(201).json({ data: { ...result.rows[0], review: evaluated.review }, message: 'Quiz attempt saved' }) }))
router.get('/quizzes/:quizId/attempts', asyncHandler(async (request, response) => { const result = await pool.query('SELECT id, answers, score, submitted_at FROM quiz_attempts WHERE quiz_id = $1 AND student_id = $2 ORDER BY submitted_at DESC', [request.params.quizId, request.auth?.userId]); response.json({ data: result.rows }) }))
router.post('/assignments/:assignmentId/submissions', asyncHandler(async (request, response) => { const content = z.unknown().parse(request.body.content); await requirePublishedActivity(request.auth!.userId, 'assignments', String(request.params.assignmentId)); const result = await pool.query('INSERT INTO submissions (assignment_id, student_id, content) VALUES ($1, $2, $3) ON CONFLICT (assignment_id, student_id) DO UPDATE SET content = EXCLUDED.content, submitted_at = now() RETURNING id, submitted_at', [request.params.assignmentId, request.auth?.userId, JSON.stringify(content)]); response.status(201).json({ data: result.rows[0] }) }))
router.get('/assignments', asyncHandler(async (request, response) => { const courseId = z.string().uuid().optional().parse(request.query.courseId); const result = await pool.query(`SELECT a.id, a.course_id, a.title, a.instructions, a.due_at, a.total_marks, a.resources, s.id AS submission_id, s.content AS submission_content, s.score, s.feedback FROM assignments a LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = $1 WHERE ($2::uuid IS NULL OR a.course_id = $2) ORDER BY a.due_at`, [request.auth?.userId, courseId || null]); response.json({ data: result.rows }) }))
router.post('/exams/:examId/attempts', asyncHandler(async (request, response) => { const answers = z.record(z.string(), z.string()).parse(request.body.answers); const examId = String(request.params.examId); await requirePublishedActivity(request.auth!.userId, 'exams', examId); const evaluated = await scoreAssessment('exam_questions', 'exam_answers', 'exam_id', examId, answers); const result = await pool.query('INSERT INTO exam_attempts (exam_id, student_id, answers, score, submitted_at) VALUES ($1, $2, $3, $4, now()) RETURNING id, score, submitted_at', [examId, request.auth?.userId, JSON.stringify(answers), evaluated.score]); response.status(201).json({ data: { ...result.rows[0], review: evaluated.review }, message: 'Exam attempt saved' }) }))
router.get('/exams/:examId/attempts', asyncHandler(async (request, response) => { const result = await pool.query('SELECT id, answers, score, started_at, submitted_at FROM exam_attempts WHERE exam_id = $1 AND student_id = $2 ORDER BY started_at DESC', [request.params.examId, request.auth?.userId]); response.json({ data: result.rows }) }))
router.post('/tests/:testId/attempts', asyncHandler(async (request, response) => { const answers = z.record(z.string(), z.string()).parse(request.body.answers); const testId = String(request.params.testId); await requirePublishedActivity(request.auth!.userId, 'tests', testId); const evaluated = await scoreAssessment('test_questions', 'test_answers', 'test_id', testId, answers); const result = await pool.query('INSERT INTO test_attempts (test_id, student_id, answers, score) VALUES ($1, $2, $3, $4) RETURNING id, score, submitted_at', [testId, request.auth?.userId, JSON.stringify(answers), evaluated.score]); response.status(201).json({ data: { ...result.rows[0], review: evaluated.review }, message: 'Test attempt saved' }) }))
router.get('/tests/:testId/attempts', asyncHandler(async (request, response) => { const result = await pool.query('SELECT id, answers, score, submitted_at FROM test_attempts WHERE test_id = $1 AND student_id = $2 ORDER BY submitted_at DESC', [request.params.testId, request.auth?.userId]); response.json({ data: result.rows }) }))
router.get('/me/progress', asyncHandler(async (request, response) => { const result = await pool.query('SELECT course_id, count(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completed_lessons, sum(seconds_spent)::int AS seconds_spent FROM progress WHERE student_id = $1 GROUP BY course_id', [request.auth?.userId]); response.json({ data: result.rows }) }))
router.get('/me/notifications', asyncHandler(async (request, response) => { const result = await pool.query('SELECT id, title, body, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [request.auth?.userId]); response.json({ data: result.rows }) }))
router.get('/me/achievements', asyncHandler(async (request, response) => { const result = await pool.query('SELECT a.key, a.name, a.description, sa.earned_at FROM student_achievements sa JOIN achievements a ON a.id = sa.achievement_id WHERE sa.student_id = $1 ORDER BY sa.earned_at DESC', [request.auth?.userId]); response.json({ data: result.rows }) }))
router.get('/me/certificates', asyncHandler(async (request, response) => { const result = await pool.query('SELECT id, course_id, issued_at, certificate_url FROM certificates WHERE student_id = $1 ORDER BY issued_at DESC', [request.auth?.userId]); response.json({ data: result.rows }) }))

export default router
