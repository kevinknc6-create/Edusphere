import { ArrowRight, BookOpen, FileText } from 'lucide-react'
import type { EducationProfile, LearningDashboard, LearningSummary } from '../lib/api'
import StudentLearningMaterials from './StudentLearningMaterials'

export type StudentCourse = {
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
    learningDashboardLoading?: boolean
    learningDashboardError?: string
    onRefreshLearningDashboard?: () => void
    onOpenCourse: (course: StudentCourse) => void
    onViewAllCourses: () => void
    summary: LearningSummary | null
    profile: EducationProfile | null
    onChangeLearningPath: () => void
    category: 'primary' | 'secondary'
    mode?: 'overview' | 'learning'
}

export default function StudentDashboard({ userName, courses, learningDashboard, learningDashboardLoading = false, learningDashboardError = '', onRefreshLearningDashboard, onOpenCourse, onViewAllCourses, category, mode = 'overview' }: Props) {
    const isPrimary = category === 'primary'
    const isLearning = mode === 'learning'
    const firstName = userName.trim().split(/\s+/)[0] || 'learner'
    const materials = learningDashboard?.materials || []
    if (isLearning) {
        return <div className={`student-dashboard curriculum-dashboard ${isPrimary ? 'primary-learning-dashboard' : 'secondary-learning-dashboard'} student-learning-view`}>
            <header className="student-dashboard-header">
                <div>
                    <p className="student-kicker">Your learning library</p>
                    <h1>My learning</h1>
                    <p className="student-header-copy">Learning materials assigned to your class and school.</p>
                </div>
            </header>
            <section className="student-section-block">
                <div className="student-section-heading">
                    <div><span className="student-section-label">Assigned to you</span><h2>Learning materials</h2></div>
                    <span>{materials.length} {materials.length === 1 ? 'item' : 'items'}</span>
                </div>
                {learningDashboardError && <p className="learning-material-notice error" role="alert">{learningDashboardError} {onRefreshLearningDashboard && <button className="curriculum-open-button" onClick={onRefreshLearningDashboard}>Try again</button>}</p>}
                {learningDashboardLoading && !learningDashboard
                    ? <div className="curriculum-empty"><FileText size={22} /><p>Loading your learning materials...</p></div>
                    : materials.length
                    ? <StudentLearningMaterials materials={materials} />
                    : !learningDashboardError && <div className="curriculum-empty"><FileText size={22} /><p>No learning materials have been assigned yet.</p><small>Materials must be published and match your school, class, program, and subject. If you expected a PDF, ask your school administrator to check its assignment and publishing status.</small></div>}
            </section>
        </div>
    }

    return <div className={`student-dashboard curriculum-dashboard ${isPrimary ? 'primary-learning-dashboard' : 'secondary-learning-dashboard'} student-overview-view`}>
        <header className="student-dashboard-header">
            <div>
                <p className="student-kicker">{isPrimary ? 'My learning space' : 'My academic workspace'} <span className="student-live-dot" /></p>
                <h1>{isPrimary ? `Hello, ${firstName}!` : `Welcome back, ${firstName}.`}</h1>
                <p className="student-header-copy">{isPrimary ? 'Here are a few lessons chosen for your class. Your full learning library is in My learning.' : 'Your daily learning snapshot and a few of your assigned courses.'}</p>
            </div>
            <div className="student-header-actions" />
        </header>

        <section className="student-section-block">
            <div className="student-section-heading">
                <div><span className="student-section-label">Pick up where you left off</span><h2>Your courses</h2></div>
                {courses.length > 3 && <button onClick={onViewAllCourses}>See all {courses.length} courses <ArrowRight size={15} /></button>}
            </div>
            {courses.length ? <div className="student-course-grid curriculum-course-grid">
                {courses.slice(0, 3).map((course) => <article className="student-course-card" key={course.id}>
                    <div className="student-course-thumb sky"><BookOpen size={22} /><small>{course.lessons} {course.lessons === 1 ? 'lesson' : 'lessons'}</small></div>
                    <div className="student-course-card-body"><span>{course.category}</span><h3>{course.title}</h3><p>{course.description || 'A learning resource shared for your class.'}</p>
                        <button className="curriculum-open-button" onClick={() => onOpenCourse(course)}>Open learning <ArrowRight size={15} /></button>
                    </div>
                </article>)}
            </div> : <div className="curriculum-empty"><FileText size={22} /><p>No courses have been assigned to your class yet.</p><small>Your dashboard will update when your school or teacher publishes content.</small></div>}
        </section>
    </div>
}
