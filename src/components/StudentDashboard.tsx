import { useState, type FormEvent } from 'react'
import { ArrowRight, Award, Bell, BookOpen, CalendarDays, CheckCircle2, ChevronRight, Clock3, Flame, GraduationCap, House, Menu, Play, Search, Send, Settings2, Sparkles, Target, Trophy, Users } from 'lucide-react'
import { api, type EducationProfile, type LearningSummary } from '../lib/api'

type StudentCourse = {
    id: string | number
    title: string
    category: string
    teacher: string
    lessons: number
    progress: number
    difficulty: string
    color: string
    icon: string
    description: string
}

type StudentDashboardProps = {
    userName: string
    courses: StudentCourse[]
    subjects: Array<{ id: string | number; name: string; description: string }>
    onExplore: () => void
    onOpenCourse: (course: StudentCourse) => void
    query: string
    onQueryChange: (query: string) => void
    summary: LearningSummary | null
    profile: EducationProfile | null
    onChangeLearningPath: () => void
}

const recentLessons = [
    { title: 'Solving one-step equations', subject: 'Algebra foundations', duration: '22 min', progress: 78, color: 'mint' },
    { title: 'The balance method', subject: 'Algebra foundations', duration: '14 min', progress: 100, color: 'sun' },
    { title: 'Forces and motion', subject: 'Introduction to physics', duration: '18 min', progress: 36, color: 'sky' },
]

const upcomingWork = [
    { type: 'Quiz', title: 'Practice: equations', detail: 'Algebra foundations', due: 'Due today', color: 'coral' },
    { type: 'Test', title: 'Motion and energy check', detail: 'Introduction to physics', due: 'Tomorrow', color: 'sky' },
    { type: 'Homework', title: 'Build a landing page', detail: 'Modern web development', due: 'Sep 24', color: 'violet' },
]

export default function StudentDashboard({ userName, courses, subjects, onExplore, onOpenCourse, query, onQueryChange, summary, profile, onChangeLearningPath }: StudentDashboardProps) {
    const [aiQuestion, setAiQuestion] = useState('')
    const [aiAnswer, setAiAnswer] = useState('')
    const [aiBusy, setAiBusy] = useState(false)
    const [aiError, setAiError] = useState('')
    const initials = userName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
    const activeCourses = courses.filter((course) => course.progress > 0 && course.progress < 100)
    const continueCourse = activeCourses[0] || courses[0]
    const score = summary?.scores.find((item) => item.type === 'quiz')?.average_score || 0
    const learningPath = `${profile?.program_name || profile?.grade_name || profile?.education_level_name || 'Your learning path'} · ${score}% quiz average`

    async function askAi(event: FormEvent) {
        event.preventDefault()
        if (!aiQuestion.trim()) return
        setAiBusy(true)
        setAiError('')
        try {
            const result = await api.aiChat({ message: aiQuestion, educationLevel: localStorage.getItem('edusphere-education-level') || 'Secondary 5' })
            setAiAnswer(result.data.answer)
            setAiQuestion('')
        } catch (error) {
            setAiError(error instanceof Error ? error.message : 'Edusphere AI is temporarily unavailable.')
        } finally {
            setAiBusy(false)
        }
    }

    return <div className="student-dashboard">
        <div className="student-mobile-header">
            <button className="student-icon-button" aria-label="Open navigation"><Menu size={20} /></button>
            <div className="student-brand"><span><Sparkles size={15} /></span>Edu<span>Sphere</span></div>
            <button className="student-avatar" aria-label="Open profile">{initials || 'S'}</button>
        </div>

        <header className="student-dashboard-header">
            <div>
                <p className="student-kicker">Thursday, September 17, 2026 <span className="student-live-dot" /> {learningPath}</p>
                <h1>Good morning, {userName.split(' ')[0] || 'student'}.</h1>
                <p className="student-header-copy">Make a little progress today. It adds up faster than you think.</p>
            </div>
            <div className="student-header-actions">
                <button className="student-icon-button" aria-label="Notifications"><Bell size={19} /><i /></button>
                <button className="student-icon-button" aria-label={profile?.education_level_id ? 'Change learning path' : 'Set up learning path'} title={profile?.education_level_id ? 'Change learning path' : 'Set up learning path'} onClick={onChangeLearningPath}><Settings2 size={19} /></button>
                <button className="student-profile-button"><span className="student-avatar">{initials || 'S'}</span><span><strong>{userName}</strong><small>Student profile</small></span><ChevronRight size={16} /></button>
            </div>
        </header>

        <section className="student-command-row">
            <div className="student-ai-card">
                <div className="student-ai-orbit" aria-hidden="true"><Sparkles size={25} /></div>
                <div className="student-ai-copy"><span className="student-section-label"><Sparkles size={13} /> Edusphere AI</span><h2>What are you curious about?</h2><p>Get a clear explanation, a worked example, or a practice plan for your next lesson.</p><form className="student-ai-form" onSubmit={askAi}><input value={aiQuestion} onChange={(event) => setAiQuestion(event.target.value)} placeholder="Ask your learning assistant..." aria-label="Ask Edusphere AI" /><button disabled={aiBusy || !aiQuestion.trim()} aria-label="Ask Edusphere AI">{aiBusy ? <Clock3 size={17} /> : <Send size={17} />}</button></form>{aiError && <small className="student-ai-error">{aiError}</small>}{aiAnswer && <div className="student-ai-answer"><strong>Edusphere AI</strong><p>{aiAnswer}</p></div>}</div>
                <div className="student-ai-prompts"><button onClick={() => setAiQuestion('Explain my current lesson simply')}>Explain simply</button><button onClick={() => setAiQuestion('Give me a practice question')}>Practice with me</button></div>
            </div>
            <div className="student-streak-card"><div className="student-streak-icon"><Flame size={20} /></div><span className="student-section-label">Your rhythm</span><strong>{summary?.learningStreak || 0} day streak</strong><p>One focused session keeps your momentum alive.</p><div className="student-week"><i /><i /><i /><i /><i className="today" /><i /><i /></div><small>Keep returning to build your streak.</small></div>
        </section>

        <div className="student-search-row"><label><Search size={18} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search your courses, lessons, and subjects" /><kbd>⌘ K</kbd></label><button className="student-explore-button" onClick={onExplore}>Explore all subjects <ArrowRight size={16} /></button></div>

        <section className="student-section-block">
            <div className="student-section-heading"><div><span className="student-section-label">My learning</span><h2>Pick up where you left off</h2></div><button onClick={onExplore}>View all learning <ArrowRight size={15} /></button></div>
            <div className="student-learning-grid">
                <article className="student-continue-card" onClick={() => continueCourse && onOpenCourse(continueCourse)}><div className={`student-course-art ${continueCourse?.color || 'coral'}`}><span>{continueCourse?.icon || 'x'}</span><em>Continue learning</em><button aria-label="Play course"><Play size={18} fill="currentColor" /></button></div><div className="student-continue-body"><div><span>{continueCourse?.category || 'Mathematics'}</span><h3>{continueCourse?.title || 'Algebra foundations'}</h3><p>Lesson 3 · Solving one-step equations</p></div><strong>{continueCourse?.progress || 0}%</strong><div className="student-progress"><i style={{ width: `${continueCourse?.progress || 0}%` }} /></div><small><Clock3 size={14} /> 22 min remaining in this lesson</small></div></article>
                <div className="student-progress-card"><div className="student-card-heading"><span className="student-section-label">Progress</span><Target size={19} /></div><div className="student-progress-number"><strong>86%</strong><span>average score</span></div><div className="student-progress-lines"><span><i className="blue" style={{ width: '86%' }} />Course mastery</span><span><i className="green" style={{ width: '74%' }} />Completion rate</span><span><i className="orange" style={{ width: '62%' }} />Weekly goal</span></div><button>See your progress <ArrowRight size={14} /></button></div>
            </div>
        </section>

        <section className="student-section-block"><div className="student-section-heading"><div><span className="student-section-label">My courses</span><h2>Learning paths in motion</h2></div><button onClick={onExplore}>Browse courses <ArrowRight size={15} /></button></div><div className="student-course-grid">{courses.slice(0, 3).map((course) => <article className="student-course-card" key={course.id} onClick={() => onOpenCourse(course)}><div className={`student-course-thumb ${course.color}`}><span>{course.icon}</span><small>{course.difficulty}</small></div><div className="student-course-card-body"><span>{course.category}</span><h3>{course.title}</h3><p>with {course.teacher}</p><div className="student-course-card-footer"><div className="student-progress"><i style={{ width: `${course.progress}%` }} /></div><strong>{course.progress}%</strong></div><small><BookOpen size={13} /> {course.lessons} lessons</small></div></article>)}</div></section>

        <section className="student-two-column"><div className="student-panel"><div className="student-section-heading compact"><div><span className="student-section-label">Recent lessons</span><h2>Small wins</h2></div><button>View history <ArrowRight size={14} /></button></div><div className="student-lesson-list">{recentLessons.map((lesson) => <button className="student-lesson-row" key={lesson.title}><span className={`student-lesson-icon ${lesson.color}`}><Play size={14} fill="currentColor" /></span><span><strong>{lesson.title}</strong><small>{lesson.subject} · {lesson.duration}</small></span><span className="student-lesson-progress"><i style={{ width: `${lesson.progress}%` }} /></span><b>{lesson.progress}%</b><ChevronRight size={16} /></button>)}</div></div><div className="student-panel student-subject-panel"><div className="student-section-heading compact"><div><span className="student-section-label">Subjects</span><h2>Explore by interest</h2></div><button onClick={onExplore} aria-label="View subjects"><ArrowRight size={15} /></button></div><div className="student-subject-list">{subjects.slice(0, 6).map((subject, index) => <button key={subject.id} onClick={onExplore}><span className={`subject-dot ${['coral', 'sky', 'violet', 'mint'][index % 4]}`}>{subject.name.slice(0, 2)}</span><span><strong>{subject.name}</strong><small>Explore learning</small></span><ChevronRight size={15} /></button>)}{!subjects.length && <small>No curriculum subjects are published for this learning path yet.</small>}</div></div></section>

        <section className="student-section-block student-work-section"><div className="student-section-heading"><div><span className="student-section-label">Your study desk</span><h2>Stay ready for what is next</h2></div><button>Open calendar <CalendarDays size={15} /></button></div><div className="student-work-grid">{upcomingWork.map((work) => <article className="student-work-card" key={work.title}><div className={`student-work-mark ${work.color}`}><CheckCircle2 size={17} /></div><div><span>{work.type}</span><h3>{work.title}</h3><p>{work.detail}</p></div><small>{work.due}</small><button aria-label={`Open ${work.title}`}><ArrowRight size={15} /></button></article>)}</div></section>

        <section className="student-bottom-row"><div className="student-achievement-banner"><div className="student-trophy"><Trophy size={22} /></div><div><span className="student-section-label">Achievements</span><h2>Keep building your collection</h2><p>You are one lesson away from unlocking <strong>Curious mind</strong>.</p></div><button>View achievements <Award size={16} /></button></div><div className="student-community-card"><Users size={19} /><div><strong>Study groups</strong><span>Find learners on the same path</span></div><ArrowRight size={16} /></div></section>

        <footer className="student-dashboard-footer"><span><GraduationCap size={17} /> Learning is a journey, not a race.</span><span><House size={14} /> EduSphere student workspace</span></footer>
    </div>
}
