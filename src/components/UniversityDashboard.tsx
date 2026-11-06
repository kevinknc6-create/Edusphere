import { BookOpen, CalendarDays, CheckCircle2, ClipboardList, GraduationCap, Layers3, NotebookPen, Play, Target } from 'lucide-react'
import type { UniversityDashboard as UniversityDashboardData } from '../lib/api'
import type { StudentCourse } from './StudentDashboard'

type Props = { data: UniversityDashboardData | null; loading: boolean; courses: StudentCourse[]; onOpenCourse: (course: StudentCourse) => void; onViewAllCourses: () => void; onChangeLearningPath: () => void }

const sections = [
    ['My Courses', 'courses', BookOpen],
    ['Modules', 'modules', Layers3],
    ['Lessons', 'lessons', Play],
    ['Notes', 'notes', NotebookPen],
    ['Exercises', 'exercises', Target],
    ['Quizzes', 'quizzes', ClipboardList],
    ['Tests', 'tests', CheckCircle2],
    ['Exams', 'exams', GraduationCap],
    ['Results', 'results', CheckCircle2],
    ['Progress', 'progress', Target],
] as const

export default function UniversityDashboard({ data, loading, courses, onOpenCourse, onViewAllCourses, onChangeLearningPath }: Props) {
    const profile = data?.profile
    const program = data?.program as { faculty_name?: string; department_name?: string; award?: string } | null
    return <div className="student-dashboard university-dashboard">
        <header className="student-dashboard-header"><div><p className="student-kicker"><GraduationCap size={15} /> University learning path</p><h1>{profile?.program_name || 'University program'} dashboard</h1><p className="student-header-copy">{program?.faculty_name || 'Faculty'} · {program?.department_name || 'Department'} · {program?.award || 'Program courses'}</p></div><button className="student-explore-button" onClick={onChangeLearningPath}>Change learning path</button></header>
        <section className="student-section-block">
            <div className="student-section-heading"><div><span className="student-section-label">Program overview</span><h2>{profile?.program_name || 'Selected program'}</h2></div><CalendarDays size={22} /></div>
            <p className="student-header-copy">{loading ? 'Loading your program catalog...' : 'Courses are limited to your selected university program.'}</p>
            <div className="student-section-heading university-course-heading"><div><span className="student-section-label">Your program</span><h2>Courses to continue</h2></div>{courses.length > 3 && <button onClick={onViewAllCourses}>See all {courses.length} courses</button>}</div>
            {courses.length ? <div className="student-course-grid curriculum-course-grid">{courses.slice(0, 3).map((course) => <article className="student-course-card" key={course.id}>
                <div className="student-course-thumb violet"><BookOpen size={22} /><small>{course.lessons} {course.lessons === 1 ? 'lesson' : 'lessons'}</small></div>
                <div className="student-course-card-body"><span>{course.category}</span><h3>{course.title}</h3><p>{course.description || 'A course assigned to your program.'}</p><button className="curriculum-open-button" onClick={() => onOpenCourse(course)}>Open course <BookOpen size={15} /></button></div>
            </article>)}</div> : <div className="curriculum-empty"><BookOpen size={22} /><p>{loading ? 'Loading assigned courses…' : 'No courses have been assigned to your program yet.'}</p></div>}
        </section>
        <section className="student-course-grid">{sections.map(([label, key, Icon]) => { const count = data?.[key].length || 0; return <article className="student-course-card" key={key}><div className="student-course-thumb violet"><Icon size={22} /><small>{count} available</small></div><div className="student-course-card-body"><span>University</span><h3>{label}</h3><p>{count ? 'Open program content' : 'No published content yet'}</p></div></article> })}</section>
    </div>
}
