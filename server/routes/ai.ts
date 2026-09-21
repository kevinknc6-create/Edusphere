import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { env } from '../config.js'
import { pool } from '../db/pool.js'
import { HttpError, asyncHandler } from '../errors.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
const aiRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Edusphere AI is temporarily unavailable. Please try again later.' } })
const chatInput = z.object({
    message: z.string().trim().min(1).max(4000),
    conversationId: z.string().uuid().optional(),
    courseId: z.string().uuid().optional(),
    lessonId: z.string().uuid().optional(),
    educationLevel: z.string().trim().max(120).optional(),
    language: z.string().trim().max(40).default('English'),
})

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

async function buildContext(input: z.infer<typeof chatInput>) {
    const context: string[] = []
    if (input.courseId) {
        const course = await pool.query(`SELECT c.title, c.description, s.name AS subject, c.difficulty FROM courses c JOIN subjects s ON s.id = c.subject_id WHERE c.id = $1`, [input.courseId])
        if (course.rows[0]) context.push(`Course: ${course.rows[0].title}; subject: ${course.rows[0].subject}; difficulty: ${course.rows[0].difficulty}; description: ${course.rows[0].description}`)
    }
    if (input.lessonId) {
        const lesson = await pool.query(`SELECT l.title, l.content, m.title AS module FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.id = $1`, [input.lessonId])
        if (lesson.rows[0]) context.push(`Lesson: ${lesson.rows[0].title}; module: ${lesson.rows[0].module}; content: ${JSON.stringify(lesson.rows[0].content)}`)
    }
    return context.join('\n')
}

async function askProvider(messages: ChatMessage[]) {
    if (!env.AI_API_KEY) throw new HttpError(503, 'Edusphere AI is temporarily unavailable. Please try again.')
    const response = await fetch(env.AI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.AI_API_KEY}` },
        body: JSON.stringify({ model: env.AI_MODEL, messages, temperature: 0.3 }),
        signal: AbortSignal.timeout(30_000),
    }).catch(() => null)
    if (!response || !response.ok) throw new HttpError(503, 'Edusphere AI is temporarily unavailable. Please try again.')
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const answer = payload.choices?.[0]?.message?.content?.trim()
    if (!answer) throw new HttpError(503, 'Edusphere AI returned an empty response. Please try again.')
    return answer
}

router.use(requireAuth, aiRateLimit)

router.post('/chat', asyncHandler(async (request, response) => {
    const input = chatInput.parse(request.body)
    const userId = request.auth!.userId
    const context = await buildContext(input)
    let conversationId = input.conversationId
    if (conversationId) {
        const owned = await pool.query('SELECT id FROM ai_conversations WHERE id = $1 AND user_id = $2', [conversationId, userId])
        if (!owned.rows[0]) throw new HttpError(404, 'Conversation not found')
    } else {
        const created = await pool.query(`INSERT INTO ai_conversations (user_id, course_id, lesson_id, title) VALUES ($1, $2, $3, $4) RETURNING id`, [userId, input.courseId || null, input.lessonId || null, input.message.slice(0, 80)])
        conversationId = created.rows[0].id as string
    }
    const history = await pool.query(`SELECT role, content FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 12`, [conversationId])
    const level = input.educationLevel || 'the learner\'s current education level'
    const system = `You are Edusphere AI, a patient learning assistant for ${level}. Explain clearly, check understanding, and adapt examples to the learner. Do not invent course facts. Reply in ${input.language}. ${context ? `Use this learning context:\n${context}` : ''}`
    const messages: ChatMessage[] = [{ role: 'system', content: system }, ...history.rows.reverse().map((item) => ({ role: item.role as 'user' | 'assistant', content: item.content as string })), { role: 'user', content: input.message }]
    const answer = await askProvider(messages)
    await pool.query('INSERT INTO ai_messages (conversation_id, role, content) VALUES ($1, $2, $3), ($1, $4, $5)', [conversationId, 'user', input.message, 'assistant', answer])
    await pool.query('UPDATE ai_conversations SET updated_at = now() WHERE id = $1', [conversationId])
    response.json({ data: { conversationId, answer } })
}))

router.post('/generate', asyncHandler(async (request, response) => {
    if (!['teacher', 'admin', 'super-admin'].includes(request.auth!.role)) throw new HttpError(403, 'Teacher access required')
    const input = z.object({ kind: z.enum(['lesson-notes', 'quiz', 'assignment', 'exam', 'answer-key', 'lesson-plan', 'revision-material']), topic: z.string().trim().min(2).max(500), educationLevel: z.string().trim().max(120).optional(), instructions: z.string().trim().max(2000).optional(), language: z.string().trim().max(40).default('English') }).parse(request.body)
    const answer = await askProvider([
        { role: 'system', content: `You create editable ${input.kind} drafts for teachers. Return structured Markdown with headings and clear answer keys where relevant. Never claim the draft is published. Use ${input.language} and adapt it to ${input.educationLevel || 'the requested learner level'}.` },
        { role: 'user', content: `Topic: ${input.topic}\nAdditional instructions: ${input.instructions || 'Use accurate, classroom-ready content.'}` },
    ])
    const saved = await pool.query(`INSERT INTO teacher_generated_content (teacher_id, kind, title, content) VALUES ($1, $2, $3, $4) RETURNING id, kind, title, content, status, created_at`, [request.auth!.userId, input.kind, input.topic, JSON.stringify({ markdown: answer })])
    response.status(201).json({ data: saved.rows[0] })
}))

export default router