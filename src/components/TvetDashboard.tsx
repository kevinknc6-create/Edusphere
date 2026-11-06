import { GraduationCap } from 'lucide-react'
import type { TvetDashboard as TvetDashboardData } from '../lib/api'
import type { StudentCourse } from './StudentDashboard'

type Props = { data: TvetDashboardData | null; loading: boolean; courses: StudentCourse[]; onOpenCourse: (course: StudentCourse) => void; onViewAllCourses: () => void; onChangeLearningPath: () => void }

export default function TvetDashboard({ data, courses, onOpenCourse, onViewAllCourses, onChangeLearningPath }: Props) {
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
            <div className="student-section-heading"><div><span className="student-section-label">Your program</span><h2>Courses to continue</h2></div>{courses.length > 3 && <button onClick={onViewAllCourses}>See all {courses.length} courses</button>}</div>
            {courses.length ? <div className="student-course-grid curriculum-course-grid">{courses.slice(0, 3).map((course) => <article className="student-course-card" key={course.id}>
                <div className="student-course-thumb sky"><GraduationCap size={22} /><small>{course.lessons} {course.lessons === 1 ? 'lesson' : 'lessons'}</small></div>
                <div className="student-course-card-body"><span>{course.category}</span><h3>{course.title}</h3><p>{course.description || 'A course assigned to your program.'}</p><button className="curriculum-open-button" onClick={() => onOpenCourse(course)}>Open course <GraduationCap size={15} /></button></div>
            </article>)}</div> : <div className="curriculum-empty"><GraduationCap size={22} /><p>No courses have been assigned to your program yet.</p></div>}
        </section>
    </div>
}
