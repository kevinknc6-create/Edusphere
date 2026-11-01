import { GraduationCap } from 'lucide-react'
import type { TvetDashboard as TvetDashboardData } from '../lib/api'
import StudentAiTutor from './StudentAiTutor'
import StudentLearningMaterials from './StudentLearningMaterials'

type Props = { data: TvetDashboardData | null; loading: boolean; onChangeLearningPath: () => void }

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
            <div className="student-section-heading"><div><span className="student-section-label">Approved resources</span><h2>Program learning materials</h2></div></div>
            <StudentLearningMaterials materials={data?.materials || []} />
            {!data?.materials.length && <p className="admin-empty">{loading ? 'Loading program materials…' : 'No approved learning materials have been published for this program and school yet.'}</p>}
        </section>
        <StudentAiTutor />
    </div>
}
