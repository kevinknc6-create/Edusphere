import { BookOpen, CheckCircle2, ClipboardList, FileText, FlaskConical, GraduationCap, Layers3, NotebookPen, Play, Target } from 'lucide-react'
import type { TvetDashboard as TvetDashboardData } from '../lib/api'

type Props = { data: TvetDashboardData | null; loading: boolean; onChangeLearningPath: () => void }

const sections = [
    ['My Modules', 'modules', Layers3],
    ['Lessons', 'lessons', Play],
    ['Practical Work', 'practicalExercises', FlaskConical],
    ['Notes', 'notes', NotebookPen],
    ['Exercises', 'exercises', FileText],
    ['Quizzes', 'quizzes', ClipboardList],
    ['Tests', 'tests', CheckCircle2],
    ['Exams', 'exams', GraduationCap],
    ['Assignments', 'assignments', FileText],
    ['Results', 'results', Target],
    ['Progress', 'progress', CheckCircle2],
] as const

export default function TvetDashboard({ data, loading, onChangeLearningPath }: Props) {
    const profile = data?.profile
    return <div className="student-dashboard tvet-dashboard">
        <header className="student-dashboard-header">
            <div>
                <p className="student-kicker"><GraduationCap size={15} /> TVET learning path</p>
                <h1>{profile?.program_name || 'TVET program'} dashboard</h1>
                <p className="student-header-copy">{profile?.grade_name || 'Select a TVET level'} · Program-specific learning content</p>
            </div>
            <button className="student-explore-button" onClick={onChangeLearningPath}>Change learning path</button>
        </header>
        <section className="student-section-block">
            <div className="student-section-heading"><div><span className="student-section-label">Program overview</span><h2>{profile?.program_name || 'Your selected program'}</h2></div><BookOpen size={22} /></div>
            <p className="student-header-copy">Only content assigned to this TVET program and level appears here.</p>
        </section>
        <section className="student-course-grid">
            {sections.map(([label, key, Icon]) => {
                const count = data?.[key].length || 0
                return <article className="student-course-card" key={key}><div className="student-course-thumb ink"><Icon size={22} /><small>{count} available</small></div><div className="student-course-card-body"><span>TVET</span><h3>{label}</h3><p>{loading ? 'Loading program content...' : count ? 'Open your program content' : 'No verified content published yet'}</p></div></article>
            })}
        </section>
        <section className="student-command-row">
            <div className="student-ai-card"><div className="student-ai-orbit"><GraduationCap size={24} /></div><div className="student-ai-copy"><span className="student-section-label">Edusphere AI</span><h2>Learn with your program context</h2><p>AI support will use your selected TVET level and program when program content is available.</p></div></div>
        </section>
    </div>
}
