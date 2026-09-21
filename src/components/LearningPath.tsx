import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, ChevronDown, ChevronRight, Clock3, FileText, ListChecks, LoaderCircle, NotebookPen, Play, Target, Trophy } from 'lucide-react'
import { api, type ApiCourseDetail } from '../lib/api'

type LearningPathProps = { courseId: string | number; fallbackTitle: string; fallbackCategory: string; fallbackDescription: string; fallbackTeacher: string; color: string; icon: string; onBack: () => void; onLesson: () => void }
type LearningResource = { icon: typeof FileText; label: string; detail: string }
const resources: LearningResource[] = [{ icon: FileText, label: 'Notes', detail: 'Key ideas and explanations' }, { icon: NotebookPen, label: 'Exercises', detail: 'Practice what you learned' }, { icon: ListChecks, label: 'Quiz', detail: 'Check your understanding' }, { icon: Target, label: 'Test', detail: 'Review the unit' }, { icon: Trophy, label: 'Exam', detail: 'Show what you know' }]

export default function LearningPath({ courseId, fallbackTitle, fallbackCategory, fallbackDescription, fallbackTeacher, color, icon, onBack, onLesson }: LearningPathProps) {
    const [course, setCourse] = useState<ApiCourseDetail | null>(null)
    const [expanded, setExpanded] = useState<string | null>(null)
    const [selectedLesson, setSelectedLesson] = useState<string | null>(null)
    const [error, setError] = useState('')
    const id = String(courseId)

    useEffect(() => {
        setCourse(null)
        setError('')
        api.course(id).then((result) => {
            setCourse(result.data)
            setExpanded(result.data?.modules[0]?.id || null)
            setSelectedLesson(result.data?.modules[0]?.lessons[0]?.id || null)
        }).catch((caught) => setError(caught instanceof Error ? caught.message : 'This learning path could not be loaded.'))
    }, [id])

    const title = course?.title || fallbackTitle
    const category = course?.subject || fallbackCategory
    const description = course?.description || fallbackDescription
    const teacher = course?.teacher || fallbackTeacher
    const modules = course?.modules || []
    const selected = useMemo(() => modules.flatMap((module) => module.lessons).find((lesson) => lesson.id === selectedLesson), [modules, selectedLesson])
    useEffect(() => { if (selectedLesson) sessionStorage.setItem('edusphere-active-lesson', selectedLesson) }, [selectedLesson])

    return <div className="learning-path-page"><button className="back-button" onClick={onBack}><ArrowLeft size={16} /> Back to learning</button><div className="learning-path-breadcrumb"><span>Learning space</span><ChevronRight size={14} /><span>{category}</span><ChevronRight size={14} /><strong>{title}</strong></div><section className="learning-path-hero"><div className={`learning-path-art ${color}`}><span>{icon}</span></div><div><span className="course-category">{category}</span><h1>{title}</h1><p>{description}</p><div className="learning-path-meta"><span><BookOpen size={14} /> {modules.length || 0} modules</span><span><Clock3 size={14} /> Self-paced</span><span>with {teacher}</span></div></div><div className="learning-path-progress"><span>Your progress</span><strong>0%</strong><div className="progress-track"><span style={{ width: '0%' }} /></div><small>Start your first lesson</small></div></section>{error && <div className="learning-path-state" role="alert">{error}</div>}{!course && !error && <div className="learning-path-state"><LoaderCircle className="education-spin" size={20} /> Loading your learning path...</div>}{course && <div className="learning-path-layout"><aside className="learning-path-curriculum"><div className="learning-path-heading"><div><span className="eyebrow">Your pathway</span><h2>Modules and lessons</h2></div><span>{modules.length} modules</span></div>{modules.length === 0 && <p className="learning-path-empty">This course is being prepared. Your lessons will appear here soon.</p>}{modules.map((module, index) => { const isOpen = expanded === module.id; return <section className={`learning-module ${isOpen ? 'open' : ''}`} key={module.id}><button className="learning-module-heading" onClick={() => setExpanded(isOpen ? null : module.id)}><span className="learning-module-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{module.title}</strong><small>{module.lessons.length} lessons</small></span>{isOpen ? <ChevronDown size={17} /> : <ChevronRight size={17} />}</button>{isOpen && <div className="learning-lesson-list">{module.lessons.map((lesson) => <button className={selectedLesson === lesson.id ? 'selected' : ''} key={lesson.id} onClick={() => setSelectedLesson(lesson.id)}><span className="learning-lesson-status">{selectedLesson === lesson.id ? <Play size={12} fill="currentColor" /> : <CheckCircle2 size={15} />}</span><span><strong>{lesson.title}</strong><small><Clock3 size={12} /> {lesson.durationMinutes || 1} min lesson</small></span><ChevronRight size={14} /></button>)}</div>}</section> })}</aside><main className="learning-path-content">{selected ? <><div className="learning-lesson-kicker"><span>Lesson in {modules.find((module) => module.lessons.some((lesson) => lesson.id === selected.id))?.title || 'your module'}</span><span><Clock3 size={14} /> {selected.durationMinutes || 1} min</span></div><h2>{selected.title}</h2><p className="learning-content-note">Your lesson content, notes, exercises, and assessments will stay connected to this lesson.</p><div className="learning-resource-grid">{resources.map(({ icon: ResourceIcon, label, detail }) => <button key={label} onClick={label === 'Notes' ? undefined : onLesson}><span className={`learning-resource-icon ${label.toLowerCase()}`}><ResourceIcon size={18} /></span><span><strong>{label}</strong><small>{detail}</small></span><ArrowRight size={15} /></button>)}</div><div className="learning-start-card"><div><span className="eyebrow">Ready when you are</span><h3>Continue with {selected.title}</h3><p>Open the lesson, save your notes, and complete the practice activities at your own pace.</p></div><button className="primary-button" onClick={onLesson}><Play size={15} fill="currentColor" /> Open lesson</button></div></> : <div className="learning-path-empty"><BookOpen size={24} /><h2>Choose a lesson</h2><p>Select a module and lesson to see its materials.</p></div>}</main></div>}</div>
}
