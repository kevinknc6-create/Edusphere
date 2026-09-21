import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Bookmark, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, FileText, Lightbulb, LoaderCircle, NotebookPen, Play, Sparkles, Target } from 'lucide-react'
import { api, type ApiCourseDetail } from '../lib/api'

type LessonExperienceProps = { courseId: string | number; lessonId?: string; courseTitle: string; onBack: () => void; onAssessment: (mode: 'practice' | 'test' | 'exam') => void }
type LessonContent = { explanation?: string; body?: string; notes?: string; examples?: Array<{ title?: string; body?: string }>; importantPoints?: string[]; resources?: Array<{ title?: string; url?: string }> }

function contentOf(value: unknown): LessonContent {
    if (!value || typeof value !== 'object') return {}
    return value as LessonContent
}

export default function LessonExperience({ courseId, lessonId, courseTitle, onBack, onAssessment }: LessonExperienceProps) {
    const [course, setCourse] = useState<ApiCourseDetail | null>(null)
    const [activeId, setActiveId] = useState(lessonId || '')
    const [note, setNote] = useState('')
    const [saved, setSaved] = useState(false)
    const [completed, setCompleted] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const id = String(courseId)

    useEffect(() => {
        api.course(id).then((result) => {
            setCourse(result.data)
            if (!activeId) setActiveId(result.data?.modules[0]?.lessons[0]?.id || '')
        }).catch((caught) => setError(caught instanceof Error ? caught.message : 'This lesson could not be loaded.'))
    }, [id, activeId])

    useEffect(() => {
        if (!activeId) return
        setSaved(false)
        api.lessonNote(activeId).then((result) => setNote(result.data?.body || '')).catch(() => setNote(''))
    }, [activeId])

    const allLessons = useMemo(() => course?.modules.flatMap((module) => module.lessons) || [], [course])
    const index = allLessons.findIndex((lesson) => lesson.id === activeId)
    const lesson = allLessons[index]
    const content = contentOf(lesson?.content)
    const explanation = content.explanation || content.body || 'Your teacher has not added the lesson explanation yet. Check back soon for the full learning material.'

    async function saveNote() {
        if (!activeId || !note.trim()) return
        setBusy(true)
        try { await api.saveNote(activeId, note.trim()); setSaved(true) } catch (caught) { setError(caught instanceof Error ? caught.message : 'Your note could not be saved.') } finally { setBusy(false) }
    }

    async function markCompleted() {
        if (!activeId) return
        setBusy(true)
        try { await api.saveLessonProgress(activeId, true, 0); setCompleted(true) } catch (caught) { setError(caught instanceof Error ? caught.message : 'Progress could not be saved.') } finally { setBusy(false) }
    }

    function move(next: number) { if (allLessons[next]) { setActiveId(allLessons[next].id); window.scrollTo({ top: 0, behavior: 'smooth' }) } }

    if (error && !course) return <div className="lesson-experience-state" role="alert">{error}</div>
    if (!course || !lesson) return <div className="lesson-experience-state"><LoaderCircle className="education-spin" size={20} /> Loading lesson...</div>

    return <div className="lesson-experience"><div className="lesson-experience-top"><button className="back-button" onClick={onBack}><ArrowLeft size={16} /> Back to {course.title || courseTitle}</button><div className="lesson-experience-position"><span>Lesson {index + 1} of {allLessons.length}</span><div className="progress-track"><span style={{ width: `${((index + 1) / Math.max(allLessons.length, 1)) * 100}%` }} /></div></div></div><div className="lesson-experience-breadcrumb"><span>{course.subject}</span><ChevronRight size={14} /><span>{course.title}</span><ChevronRight size={14} /><strong>{lesson.title}</strong></div><div className="lesson-experience-layout"><main className="lesson-experience-main"><div className="lesson-experience-kicker"><span>Module {course.modules.findIndex((module) => module.lessons.some((item) => item.id === lesson.id)) + 1}</span><span><Clock3 size={14} /> {lesson.durationMinutes || 1} minutes</span></div><h1>{lesson.title}</h1><p className="lesson-experience-intro">{explanation}</p><div className="lesson-media"><div className="lesson-media-orbit" /><button aria-label="Play lesson media"><Play size={24} fill="currentColor" /></button><span><Play size={13} /> Focused learning session</span></div><section className="lesson-content-section"><div className="lesson-content-heading"><Lightbulb size={18} /><h2>Important points</h2></div>{(content.importantPoints?.length ? content.importantPoints : ['Work through the explanation slowly.', 'Write down the idea in your own words.', 'Try the practice activity before moving on.']).map((point) => <div className="lesson-point" key={point}><CheckCircle2 size={16} /> <span>{point}</span></div>)}</section>{content.examples?.length ? <section className="lesson-content-section"><div className="lesson-content-heading"><NotebookPen size={18} /><h2>Examples</h2></div><div className="lesson-example-grid">{content.examples.map((example, exampleIndex) => <article key={`${example.title}-${exampleIndex}`}><span>Example {exampleIndex + 1}</span><h3>{example.title || 'Worked example'}</h3><p>{example.body}</p></article>)}</div></section> : <section className="lesson-content-section lesson-placeholder"><FileText size={19} /><div><h2>Examples and learning resources</h2><p>Examples, exercises, and resources will appear here as your teacher publishes them.</p></div></section>}<section className="lesson-content-section lesson-note-section"><div className="lesson-content-heading"><Bookmark size={18} /><h2>Your notes</h2></div><textarea value={note} onChange={(event) => { setNote(event.target.value); setSaved(false) }} placeholder="Capture the idea you want to remember..." /><div className="lesson-note-actions"><span>{saved ? 'Saved to your learning space' : 'Private to you'}</span><button className="primary-button" disabled={busy || !note.trim()} onClick={() => void saveNote()}>{busy ? <LoaderCircle size={15} /> : <Check size={15} />} Save note</button></div></section><div className="lesson-experience-actions"><button className="secondary-button" disabled={index <= 0} onClick={() => move(index - 1)}><ChevronLeft size={16} /> Previous lesson</button><button className={completed ? 'lesson-complete complete' : 'lesson-complete'} disabled={busy} onClick={() => void markCompleted()}>{completed ? <Check size={16} /> : <CheckCircle2 size={16} />} {completed ? 'Completed' : 'Mark as completed'}</button><button className="primary-button" disabled={index >= allLessons.length - 1} onClick={() => move(index + 1)}>Next lesson <ChevronRight size={16} /></button></div></main><aside className="lesson-experience-aside"><div className="lesson-tools"><span className="eyebrow">Study tools</span><h2>Keep going deeper</h2><button onClick={() => onAssessment('practice')}><Target size={17} /><span><strong>Practice questions</strong><small>Check your understanding</small></span><ArrowRight size={14} /></button><button onClick={() => onAssessment('test')}><FileText size={17} /><span><strong>Test</strong><small>Review this learning unit</small></span><ArrowRight size={14} /></button><button onClick={() => onAssessment('exam')}><FileText size={17} /><span><strong>Exam</strong><small>Put your learning to work</small></span><ArrowRight size={14} /></button><button><Sparkles size={17} /><span><strong>Ask Edusphere AI</strong><small>Get another explanation</small></span><ArrowRight size={14} /></button></div><div className="lesson-next-card"><span>Up next</span><strong>{allLessons[index + 1]?.title || 'Course complete'}</strong><small>{allLessons[index + 1] ? 'Continue your learning path' : 'You reached the end of this course'}</small></div></aside></div></div>
}
