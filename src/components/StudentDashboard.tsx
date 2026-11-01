import { ArrowRight, Award, BookOpen, ClipboardCheck, FileText, GraduationCap, Layers3, NotebookText, Play, Target } from 'lucide-react'
import type { EducationProfile, LearningDashboard, LearningSummary } from '../lib/api'
import StudentAiTutor from './StudentAiTutor'
import StudentLearningMaterials from './StudentLearningMaterials'

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

type Props = {
    userName: string
    courses: StudentCourse[]
    subjects: Array<{ id: string | number; name: string; description: string }>
    learningDashboard: LearningDashboard | null
    onExplore: () => void
    onOpenCourse: (course: StudentCourse) => void
    summary: LearningSummary | null
    profile: EducationProfile | null
    onChangeLearningPath: () => void
    category: 'primary' | 'secondary'
}

const primarySections = [
    { title: 'Lessons', detail: 'Teacher-published lessons for your class', key: 'courses', Icon: Play },
    { title: 'Learning materials', detail: 'Textbooks and resources assigned to your class', key: 'materials', Icon: BookOpen },
    { title: 'Practice', detail: 'Exercises available in your learning materials', key: 'exercises', Icon: Target },
    { title: 'Quizzes', detail: 'Check what you have learned', key: 'quizzes', Icon: ClipboardCheck },
] as const

const secondarySections = [
    { title: 'Lessons and units', detail: 'Published lessons for your class', key: 'courses', Icon: Layers3 },
    { title: 'Notes and textbooks', detail: 'Study materials assigned to your learning', key: 'materials', Icon: NotebookText },
    { title: 'Quizzes and tests', detail: 'Published assessments for your subjects', key: 'assessments', Icon: ClipboardCheck },
    { title: 'Assignments and exams', detail: 'Preparation based on assigned class content', key: 'work', Icon: GraduationCap },
] as const

function countFor(key: string, data: LearningDashboard | null, courses: StudentCourse[]) {
    if (key === 'courses') return courses.length
    if (!data) return 0
    if (key === 'materials') return data.materials.length + data.notes.length
    if (key === 'assessments') return data.quizzes.length + data.tests.length + data.exams.length
    if (key === 'work') return data.homework.length + data.exams.length
    return Array.isArray(data[key as keyof LearningDashboard]) ? (data[key as keyof LearningDashboard] as unknown[]).length : 0
}

export default function StudentDashboard({ userName, courses, subjects, learningDashboard, onExplore, onOpenCourse, summary, profile, onChangeLearningPath, category }: Props) {
    const isPrimary = category === 'primary'
    const firstName = userName.trim().split(/\s+/)[0] || 'learner'
    const className = profile?.grade_name || profile?.education_level_name || 'Class not set'
    const schoolName = profile?.school_name
    const curriculum = learningDashboard?.curriculum || []
    const sections = isPrimary ? primarySections : secondarySections
    const progress = Math.max(0, Math.min(100, summary?.overallProgress || 0))

    return <div className={`student-dashboard curriculum-dashboard ${isPrimary ? 'primary-learning-dashboard' : 'secondary-learning-dashboard'}`}>
        <header className="student-dashboard-header">
            <div>
                <p className="student-kicker">{isPrimary ? 'My learning space' : 'My academic workspace'} <span className="student-live-dot" /> {className}</p>
                <h1>{isPrimary ? `Hello, ${firstName}!` : `Welcome back, ${firstName}.`}</h1>
                <p className="student-header-copy">{isPrimary ? 'Explore the lessons and activities your school has shared.' : 'Your class learning, subject resources and progress in one place.'}</p>
            </div>
            <div className="student-header-actions">
                <button className="student-explore-button" onClick={onChangeLearningPath}>Learning profile</button>
            </div>
        </header>

        <section className="curriculum-overview" aria-label="My class">
            <div className="curriculum-overview-icon"><GraduationCap size={24} /></div>
            <div>
                <span className="student-section-label">My class</span>
                <h2>{className}</h2>
                <p>{schoolName || 'School not linked to this account'}{profile?.subject_combination_name ? ` · ${profile.subject_combination_name}` : ''}</p>
            </div>
            <div className="curriculum-overview-progress" aria-label={`Learning progress ${progress}%`}>
                <span>{progress}%</span><div className="student-progress"><i style={{ width: `${progress}%` }} /></div><small>Learning progress</small>
            </div>
        </section>

        <section className="student-section-block">
            <div className="student-section-heading">
                <div><span className="student-section-label">My subjects</span><h2>{isPrimary ? 'Subjects for your class' : 'Your subjects and combinations'}</h2></div>
                <button onClick={onExplore}>Explore learning <ArrowRight size={15} /></button>
            </div>
            {subjects.length ? <div className="curriculum-subject-grid">
                {subjects.map((subject) => <article className="curriculum-subject-card" key={subject.id}>
                    <span className="curriculum-subject-icon"><BookOpen size={19} /></span>
                    <div><h3>{subject.name}</h3><p>{subject.description || (isPrimary ? 'Open available class learning materials.' : 'Open published lessons and resources.')}</p></div>
                </article>)}
            </div> : <div className="curriculum-empty">
                <BookOpen size={22} />
                <p>{isPrimary ? 'Your school has not assigned subjects or materials here yet.' : 'No subjects have been assigned to your account yet.'}</p>
                <small>Only learning content configured for your account will appear.</small>
            </div>}
        </section>

        <section className="student-section-block">
            <div className="student-section-heading"><div><span className="student-section-label">{isPrimary ? 'Learn and practise' : 'Study and prepare'}</span><h2>{isPrimary ? 'Your learning activities' : 'Your class learning'}</h2></div></div>
            <div className="curriculum-activity-grid">
                {sections.map(({ title, detail, key, Icon }) => {
                    const count = countFor(key, learningDashboard, courses)
                    return <article className="curriculum-activity-card" key={key}>
                        <span className="curriculum-activity-icon"><Icon size={20} /></span>
                        <div><h3>{title}</h3><p>{detail}</p><small>{count} {count === 1 ? 'item' : 'items'} available</small></div>
                    </article>
                })}
            </div>
        </section>

        {learningDashboard && (learningDashboard.units.length > 0 || learningDashboard.outcomes.length > 0) && <section className="student-section-block">
            <div className="student-section-heading"><div><span className="student-section-label">Verified curriculum</span><h2>{isPrimary ? 'What you will learn' : 'Learning units and outcomes'}</h2></div></div>
            <div className="curriculum-activity-grid">
                {learningDashboard.units.map((unit) => <article className="curriculum-activity-card" key={`unit-${unit.id}`}><span className="curriculum-activity-icon"><Layers3 size={20} /></span><div><h3>{unit.title}</h3><p>{unit.subject_name}</p>{unit.description && <small>{unit.description}</small>}</div></article>)}
                {learningDashboard.outcomes.map((outcome) => <article className="curriculum-activity-card" key={`outcome-${outcome.id}`}><span className="curriculum-activity-icon"><Target size={20} /></span><div><h3>{outcome.unit_title}</h3><p>{outcome.description}</p></div></article>)}
            </div>
        </section>}

        <section className="student-section-block">
            <div className="student-section-heading"><div><span className="student-section-label">Published learning</span><h2>{isPrimary ? 'Lessons and materials' : 'Lessons, notes and examination preparation'}</h2></div></div>
            <StudentLearningMaterials materials={learningDashboard?.materials || []} />
            {courses.length ? <div className="student-course-grid curriculum-course-grid">
                {courses.map((course) => <article className="student-course-card" key={course.id}>
                    <div className="student-course-thumb sky"><BookOpen size={22} /><small>{course.lessons} {course.lessons === 1 ? 'lesson' : 'lessons'}</small></div>
                    <div className="student-course-card-body"><span>{course.category}</span><h3>{course.title}</h3><p>{course.description || 'A learning resource shared for your class.'}</p>
                        <button className="curriculum-open-button" onClick={() => onOpenCourse(course)}>Open learning <ArrowRight size={15} /></button>
                    </div>
                </article>)}
            </div> : <div className="curriculum-empty"><FileText size={22} /><p>No published learning materials are available for this class yet.</p><small>Your dashboard will update when your school or teacher publishes content.</small></div>}
        </section>

        <StudentAiTutor primary={isPrimary} />

        {curriculum.length > 0 && <details className="curriculum-sources">
            <summary><Award size={17} /> Curriculum references ({curriculum.length})</summary>
            <ul>{curriculum.map((item) => <li key={item.id}><strong>{item.name}</strong> — {item.authority}: <a href={item.source_url} target="_blank" rel="noreferrer">{item.source_title}</a>{item.version_label ? ` (${item.version_label})` : ''}</li>)}</ul>
        </details>}
    </div>
}
