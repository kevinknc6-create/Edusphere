import { BookOpen, CalendarDays, CheckCircle2, ClipboardList, GraduationCap, Layers3, NotebookPen, Play, Target } from 'lucide-react'
import type { UniversityDashboard as UniversityDashboardData } from '../lib/api'

type Props = { data: UniversityDashboardData | null; loading: boolean; onChangeLearningPath: () => void }

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

export default function UniversityDashboard({ data, loading, onChangeLearningPath }: Props) {
    const profile = data?.profile
    const program = data?.program as { faculty_name?: string; department_name?: string; award?: string } | null
    return <div className="student-dashboard university-dashboard">
        <header className="student-dashboard-header"><div><p className="student-kicker"><GraduationCap size={15} /> University learning path</p><h1>{profile?.program_name || 'University program'} dashboard</h1><p className="student-header-copy">{program?.faculty_name || 'Faculty'} · {program?.department_name || 'Department'} · {program?.award || 'Program courses'}</p></div><button className="student-explore-button" onClick={onChangeLearningPath}>Change learning path</button></header>
        <section className="student-section-block"><div className="student-section-heading"><div><span className="student-section-label">Program overview</span><h2>{profile?.program_name || 'Selected program'}</h2></div><CalendarDays size={22} /></div><p className="student-header-copy">{loading ? 'Loading your program catalog...' : 'Courses are limited to your selected university program.'}</p></section>
        <section className="student-course-grid">{sections.map(([label, key, Icon]) => { const count = data?.[key].length || 0; return <article className="student-course-card" key={key}><div className="student-course-thumb violet"><Icon size={22} /><small>{count} available</small></div><div className="student-course-card-body"><span>University</span><h3>{label}</h3><p>{count ? 'Open program content' : 'No published content yet'}</p></div></article> })}</section>
    </div>
}
