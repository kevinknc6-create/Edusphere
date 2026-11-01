import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'
import { api } from '../lib/api'

type Row = Record<string, unknown>
type Options = { users: Row[]; schools: Row[]; levels: Row[]; grades: Row[]; programs: Row[]; subjects: Row[] }
const label = (value: unknown) => value === null || value === undefined ? '' : String(value)

export default function SchoolMembershipManagement() {
    const [options, setOptions] = useState<Options>({ users: [], schools: [], levels: [], grades: [], programs: [], subjects: [] })
    const [combinations, setCombinations] = useState<Row[]>([])
    const [teacherAssignments, setTeacherAssignments] = useState<Row[]>([])
    const [student, setStudent] = useState({ userId: '', schoolId: '', levelId: '', gradeId: '', programId: '', combinationId: '' })
    const [teacher, setTeacher] = useState({ userId: '', schoolId: '', gradeId: '', programId: '', subjectId: '' })
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')

    async function loadOptions() {
        const [optionResult, curriculumResult] = await Promise.all([api.adminEnrollmentOptions(), api.adminCurriculumRegistry()])
        setOptions(optionResult.data)
        setCombinations(curriculumResult.data.combinations)
    }

    async function loadAssignments(teacherId: string) {
        if (!teacherId) { setTeacherAssignments([]); return }
        setTeacherAssignments((await api.teacherAssignments(teacherId)).data)
    }

    useEffect(() => {
        void loadOptions().catch((caught) => setError(caught instanceof Error ? caught.message : 'School assignments could not be loaded.'))
    }, [])
    useEffect(() => {
        void loadAssignments(teacher.userId).catch((caught) => setError(caught instanceof Error ? caught.message : 'Teacher assignments could not be loaded.'))
    }, [teacher.userId])

    const selectedStudent = options.users.find((user) => label(user.id) === student.userId)
    const gradesForStudent = useMemo(() => options.grades.filter((grade) => !student.levelId || label(grade.education_level_id) === student.levelId), [options.grades, student.levelId])
    const programsForStudent = useMemo(() => options.programs.filter((program) => {
        const associatedGrades = Array.isArray(program.grade_ids) ? program.grade_ids.map(label) : []
        return !student.gradeId || !associatedGrades.length || associatedGrades.includes(student.gradeId)
    }), [options.programs, student.gradeId])
    const combinationsForStudent = combinations.filter((combination) => !student.levelId || label(combination.education_level_id) === student.levelId)
    const subjectsForTeacher = options.subjects.filter((subject) =>
        (!teacher.gradeId || !subject.grade_id || label(subject.grade_id) === teacher.gradeId)
        && (!teacher.programId || !subject.program_id || label(subject.program_id) === teacher.programId))
    const activeSchools = options.schools.filter((school) => school.status === 'active')
    const students = options.users.filter((user) => user.role === 'student')
    const teachers = options.users.filter((user) => user.role === 'teacher')

    async function saveEnrollment(event: FormEvent) {
        event.preventDefault()
        if (!selectedStudent) return
        setBusy(true); setError(''); setSuccess('')
        try {
            await api.setStudentEnrollment(student.userId, {
                schoolId: student.schoolId,
                educationLevelId: student.levelId,
                gradeId: student.gradeId,
                programId: student.programId || null,
                subjectCombinationId: student.combinationId || null,
            })
            setSuccess('Student school and class assignment saved.')
            await loadOptions()
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'Student assignment could not be saved.') }
        finally { setBusy(false) }
    }

    async function saveTeacherAssignment(event: FormEvent) {
        event.preventDefault()
        setBusy(true); setError(''); setSuccess('')
        try {
            await api.setTeacherSchool(teacher.userId, teacher.schoolId)
            await api.createTeacherAssignment(teacher.userId, {
                schoolId: teacher.schoolId,
                gradeId: teacher.gradeId,
                programId: teacher.programId || null,
                subjectId: teacher.subjectId,
            })
            setSuccess('Teacher school and subject assignment saved.')
            await loadAssignments(teacher.userId)
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'Teacher assignment could not be saved.') }
        finally { setBusy(false) }
    }

    async function removeAssignment(assignmentId: string) {
        if (!teacher.userId) return
        setBusy(true); setError(''); setSuccess('')
        try {
            await api.deleteTeacherAssignment(teacher.userId, assignmentId)
            await loadAssignments(teacher.userId)
            setSuccess('Teacher assignment removed.')
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'Teacher assignment could not be removed.') }
        finally { setBusy(false) }
    }

    return <div className="admin-two-column">
        {error && <div className="auth-error admin-full-panel" role="alert">{error}</div>}
        {success && <div className="saved-notice admin-full-panel" role="status">{success}</div>}
        <section className="admin-panel">
            <p className="eyebrow">Student enrollment</p><h2>Assign school and class</h2>
            <form className="admin-create-form" onSubmit={(event) => void saveEnrollment(event)}>
                <label className="admin-field">Student<select required value={student.userId} onChange={(event) => {
                    const selected = students.find((item) => label(item.id) === event.target.value)
                    setStudent({ userId: event.target.value, schoolId: label(selected?.school_id), levelId: label(selected?.education_level_id), gradeId: label(selected?.grade_id), programId: label(selected?.program_id), combinationId: '' })
                }}><option value="">Choose student</option>{students.map((user) => <option key={label(user.id)} value={label(user.id)}>{label(user.full_name)} · {label(user.email)}</option>)}</select></label>
                <label className="admin-field">School<select required value={student.schoolId} onChange={(event) => setStudent({ ...student, schoolId: event.target.value })}><option value="">Choose active school</option>{activeSchools.map((school) => <option key={label(school.id)} value={label(school.id)}>{label(school.name)}</option>)}</select></label>
                <label className="admin-field">Education level<select required value={student.levelId} onChange={(event) => setStudent({ ...student, levelId: event.target.value, gradeId: '', programId: '', combinationId: '' })}><option value="">Choose level</option>{options.levels.map((level) => <option key={label(level.id)} value={label(level.id)}>{label(level.name)}</option>)}</select></label>
                <label className="admin-field">Class / level<select required value={student.gradeId} onChange={(event) => setStudent({ ...student, gradeId: event.target.value, programId: '' })}><option value="">Choose class</option>{gradesForStudent.map((grade) => <option key={label(grade.id)} value={label(grade.id)}>{label(grade.name)}</option>)}</select></label>
                <label className="admin-field">Program, if applicable<select value={student.programId} onChange={(event) => setStudent({ ...student, programId: event.target.value })}><option value="">No program</option>{programsForStudent.map((program) => <option key={label(program.id)} value={label(program.id)}>{label(program.name)}</option>)}</select></label>
                <label className="admin-field">Subject combination, if applicable<select value={student.combinationId} onChange={(event) => setStudent({ ...student, combinationId: event.target.value })}><option value="">Not assigned</option>{combinationsForStudent.map((item) => <option key={label(item.id)} value={label(item.id)}>{label(item.name)}</option>)}</select></label>
                <button className="primary-button" disabled={busy || !student.userId} type="submit"><Check size={15} /> Save student assignment</button>
            </form>
        </section>
        <section className="admin-panel admin-full-panel">
            <p className="eyebrow">Teacher authorization</p><h2>Assign school, class, program and subject</h2>
            <form className="admin-create-form" onSubmit={(event) => void saveTeacherAssignment(event)}>
                <label className="admin-field">Teacher<select required value={teacher.userId} onChange={(event) => setTeacher({ ...teacher, userId: event.target.value })}><option value="">Choose teacher</option>{teachers.map((user) => <option key={label(user.id)} value={label(user.id)}>{label(user.full_name)} · {label(user.email)}</option>)}</select></label>
                <label className="admin-field">School<select required value={teacher.schoolId} onChange={(event) => setTeacher({ ...teacher, schoolId: event.target.value })}><option value="">Choose active school</option>{activeSchools.map((school) => <option key={label(school.id)} value={label(school.id)}>{label(school.name)}</option>)}</select></label>
                <label className="admin-field">Class<select required value={teacher.gradeId} onChange={(event) => setTeacher({ ...teacher, gradeId: event.target.value, subjectId: '' })}><option value="">Choose class</option>{options.grades.map((grade) => <option key={label(grade.id)} value={label(grade.id)}>{label(grade.name)}</option>)}</select></label>
                <label className="admin-field">Program, if applicable<select value={teacher.programId} onChange={(event) => setTeacher({ ...teacher, programId: event.target.value, subjectId: '' })}><option value="">No program</option>{options.programs.map((program) => <option key={label(program.id)} value={label(program.id)}>{label(program.name)}</option>)}</select></label>
                <label className="admin-field">Subject<select required value={teacher.subjectId} onChange={(event) => setTeacher({ ...teacher, subjectId: event.target.value })}><option value="">Choose subject</option>{subjectsForTeacher.map((subject) => <option key={label(subject.id)} value={label(subject.id)}>{label(subject.name)}</option>)}</select></label>
                <button className="primary-button" disabled={busy || !teacher.userId} type="submit"><Plus size={15} /> Save teacher assignment</button>
            </form>
            <div className="admin-table">{teacherAssignments.map((assignment) => <div className="admin-table-row" key={label(assignment.id)}><div><strong>{label(assignment.subject_name)}</strong><small>{label(assignment.school_name)} · {label(assignment.grade_name)}{assignment.program_name ? ` · ${label(assignment.program_name)}` : ''}</small></div><button className="secondary-button" disabled={busy} onClick={() => void removeAssignment(label(assignment.id))}><Trash2 size={14} /> Remove</button></div>)}{teacher.userId && !teacherAssignments.length && <p className="admin-empty">No teaching assignments yet.</p>}</div>
        </section>
    </div>
}
