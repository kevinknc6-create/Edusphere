import { useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, RefreshCw } from 'lucide-react'
import { api } from '../lib/api'

type Row = Record<string, unknown>
type Registry = { sources: Row[]; versions: Row[]; combinations: Row[]; subjects: Row[]; programs: Row[]; curriculumUnits: Row[]; curriculumOutcomes: Row[]; tvetSubjects: Row[]; tvetCompetences: Row[]; tvetModules: Row[]; tvetUnits: Row[]; tvetOutcomes: Row[] }
type Taxonomy = { levels: Row[]; grades: Row[]; programs: Row[]; subjects: Row[] }
type Student = { id: string; full_name: string; email: string }

function value(row: Row, key: string) {
    const item = row[key]
    return typeof item === 'string' || typeof item === 'number' ? String(item) : ''
}

export default function AdminCurriculumManagement() {
    const [registry, setRegistry] = useState<Registry>({ sources: [], versions: [], combinations: [], subjects: [], programs: [], curriculumUnits: [], curriculumOutcomes: [], tvetSubjects: [], tvetCompetences: [], tvetModules: [], tvetUnits: [], tvetOutcomes: [] })
    const [taxonomy, setTaxonomy] = useState<Taxonomy>({ levels: [], grades: [], programs: [], subjects: [] })
    const [students, setStudents] = useState<Student[]>([])
    const [schools, setSchools] = useState<Row[]>([])
    const [form, setForm] = useState<Record<string, string>>({})
    const [sourceReference, setSourceReference] = useState<Record<string, string>>({})
    const [busy, setBusy] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')

    async function load() {
        setLoading(true)
        setError('')
        try {
            const [catalog, adminTaxonomy, studentUsers, schoolList] = await Promise.all([
                api.adminCurriculumRegistry(),
                api.adminTaxonomy(),
                api.adminUsers({ role: 'student', status: 'active', limit: 500 }),
                api.adminSchools({ limit: 500 }),
            ])
            setRegistry(catalog.data)
            setTaxonomy(adminTaxonomy.data)
            setSchools(schoolList.data)
            setStudents(studentUsers.data.map((user) => ({
                id: String(user.id),
                full_name: String(user.full_name || user.email || 'Student'),
                email: String(user.email || ''),
            })))
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Curriculum registry could not be loaded.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { void load() }, [])

    async function submit(event: FormEvent, action: () => Promise<unknown>, message: string, reset: string[]) {
        event.preventDefault()
        setBusy(true)
        setError('')
        setSuccess('')
        try {
            await action()
            setSuccess(message)
            setForm((current) => Object.fromEntries(Object.entries(current).map(([key, item]) => [key, reset.includes(key) ? '' : item])))
            await load()
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'The curriculum change could not be saved.')
        } finally {
            setBusy(false)
        }
    }

    async function setSourceStatus(id: string, verificationStatus: string) {
        setBusy(true)
        setError('')
        setSuccess('')
        try {
            await api.setCurriculumSourceVerification(id, verificationStatus)
            setSuccess('Source verification status saved.')
            await load()
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Source verification could not be changed.')
        } finally {
            setBusy(false)
        }
    }

    async function setVersionStatus(id: string, status: string) {
        setBusy(true)
        setError('')
        setSuccess('')
        try {
            await api.setCurriculumVersionStatus(id, status)
            setSuccess('Curriculum version status saved.')
            await load()
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Curriculum version could not be changed.')
        } finally {
            setBusy(false)
        }
    }

    async function setTvetStatus(type: string, id: string, status: string) {
        setBusy(true)
        setError('')
        setSuccess('')
        try {
            await api.setTvetCurriculumStatus(type, id, status)
            setSuccess('TVET curriculum status saved.')
            await load()
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'TVET curriculum status could not be changed.')
        } finally {
            setBusy(false)
        }
    }

    async function setCurriculumStatus(type: string, id: string, status: string) {
        setBusy(true)
        setError('')
        setSuccess('')
        try {
            await api.setCurriculumRecordStatus(type, id, status)
            setSuccess('Curriculum record status saved.')
            await load()
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Curriculum record status could not be changed.')
        } finally {
            setBusy(false)
        }
    }

    async function verifyProgram(program: Row) {
        const id = value(program, 'id')
        const reference = sourceReference[id]?.trim() || value(program, 'curriculum_source_reference')
        setBusy(true)
        setError('')
        setSuccess('')
        try {
            await api.setProgramCurriculumVerification(id, { verificationStatus: 'verified', sourceReference: reference })
            setSuccess(`${value(program, 'name')} is verified and available for new TVET profiles.`)
            await load()
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Program verification could not be saved.')
        } finally {
            setBusy(false)
        }
    }

    const levels = taxonomy.levels.map((row) => ({ id: value(row, 'id'), name: value(row, 'name') }))
    const versions = registry.versions.map((row) => ({ id: value(row, 'id'), name: `${value(row, 'source_title')} · ${value(row, 'version_label')}`, status: value(row, 'status'), verified: value(row, 'verification_status') === 'verified' }))
    const verifiedVersions = versions.filter((version) => version.status === 'active' && version.verified)
    const grades = taxonomy.grades.map((row) => ({ id: value(row, 'id'), name: value(row, 'name'), levelId: value(row, 'education_level_id') }))
    const tvetPrograms = registry.programs.filter((program) => Array.isArray(program.grade_ids) && program.grade_ids.length > 0 && value(program, 'curriculum_verification_status') === 'verified')
    const tvetGrades = taxonomy.grades.filter((grade) => /^L[345]$/i.test(value(grade, 'code')))
    const selectedTvetProgram = tvetPrograms.find((program) => value(program, 'id') === form.tvetProgramId)
    const selectedTvetGradeIds = selectedTvetProgram && Array.isArray(selectedTvetProgram.grade_ids) ? selectedTvetProgram.grade_ids : []
    const tvetSubjects = registry.tvetSubjects.map((row) => ({ id: value(row, 'id'), name: `${value(row, 'program_name')} · ${value(row, 'grade_name')} · ${value(row, 'name')}`, status: value(row, 'status') }))
    const tvetCompetences = registry.tvetCompetences.map((row) => ({ id: value(row, 'id'), name: `${value(row, 'subject_name')} · ${value(row, 'title')}`, status: value(row, 'status') }))
    const tvetModules = registry.tvetModules.map((row) => ({ id: value(row, 'id'), name: `${value(row, 'competence_title')} · ${value(row, 'title')}`, status: value(row, 'status') }))
    const tvetUnits = registry.tvetUnits.map((row) => ({ id: value(row, 'id'), name: `${value(row, 'module_title')} · ${value(row, 'title')}`, status: value(row, 'status') }))
    const verifiedCurriculumSubjects = registry.subjects.filter((row) => value(row, 'verification_status') === 'verified' && value(row, 'version_status') === 'active').map((row) => ({ id: value(row, 'id'), name: `${value(row, 'name')} · ${value(row, 'education_level_name')}${value(row, 'grade_name') ? ` / ${value(row, 'grade_name')}` : ''}` }))
    const curriculumUnits = registry.curriculumUnits.map((row) => ({ id: value(row, 'id'), name: `${value(row, 'subject_name')} · ${value(row, 'title')}`, status: value(row, 'status') }))
    const combinations = registry.combinations.map((row) => ({ id: value(row, 'id'), name: `${value(row, 'name')} (${value(row, 'education_level_name')})` }))
    const activeCombinations = registry.combinations.filter((row) => value(row, 'verification_status') === 'verified' && value(row, 'version_status') === 'active')
    const mappedSubjects = verifiedCurriculumSubjects

    return <div className="admin-curriculum-management">
        <section className="admin-panel admin-full-panel">
            <div className="section-heading compact"><div><p className="eyebrow">Source and version control</p><h2>Official curriculum registry</h2></div><button className="secondary-button" onClick={() => void load()} disabled={loading || busy}><RefreshCw size={15} /> Refresh</button></div>
            <p className="admin-empty">Review the linked official document before verifying a source. Only verified sources and active versions can appear as curriculum in student dashboards.</p>
            {registry.sources.map((source) => <div className="admin-table-row" key={value(source, 'id')}>
                <div><strong>{value(source, 'authority')} · {value(source, 'title')}</strong><small><a href={value(source, 'url')} target="_blank" rel="noreferrer">{value(source, 'url')}</a></small></div>
                <span className={`status-pill ${value(source, 'verification_status') === 'verified' ? 'published' : 'draft'}`}>{value(source, 'verification_status')}</span>
                <select aria-label={`Set verification status for ${value(source, 'title')}`} value={value(source, 'verification_status')} disabled={busy} onChange={(event) => void setSourceStatus(value(source, 'id'), event.target.value)}>
                    <option value="unverified">Unverified</option><option value="in_review">In review</option><option value="verified">Verified</option>
                </select>
            </div>)}
            <div className="admin-table">{registry.versions.map((version) => <div className="admin-table-row" key={value(version, 'id')}>
                <div><strong>{value(version, 'version_label')}</strong><small>{value(version, 'source_title')}</small></div>
                <span className={`status-pill ${value(version, 'status') === 'active' ? 'published' : 'draft'}`}>{value(version, 'status')}</span>
                <button className="secondary-button" disabled={busy || value(version, 'status') === 'active'} onClick={() => void setVersionStatus(value(version, 'id'), 'active')}>Activate version</button>
                <button className="secondary-button" disabled={busy || value(version, 'status') !== 'active'} onClick={() => void setVersionStatus(value(version, 'id'), 'retired')}>Retire</button>
            </div>)}</div>
            {loading && <p className="admin-empty">Loading curriculum sources...</p>}
        </section>

        <section className="admin-panel">
            <p className="eyebrow">Upper-secondary structure</p><h2>Add subject combination</h2>
            <form className="admin-create-form" onSubmit={(event) => void submit(event, () => api.createCurriculumCombination({
                curriculumVersionId: form.combinationVersionId, educationLevelId: form.combinationLevelId, code: form.combinationCode, name: form.combinationName, description: form.combinationDescription, sourceReference: form.combinationReference,
            }), 'Subject combination saved as curriculum data.', ['combinationCode', 'combinationName', 'combinationDescription', 'combinationReference'])}>
                <label className="admin-field">Curriculum version<select required value={form.combinationVersionId || ''} onChange={(event) => setForm({ ...form, combinationVersionId: event.target.value })}><option value="">Choose version</option>{versions.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}</select></label>
                <label className="admin-field">Education level<select required value={form.combinationLevelId || ''} onChange={(event) => setForm({ ...form, combinationLevelId: event.target.value })}><option value="">Choose level</option>{levels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label className="admin-field">Combination code<input required value={form.combinationCode || ''} onChange={(event) => setForm({ ...form, combinationCode: event.target.value })} /></label>
                <label className="admin-field">Combination name<input required value={form.combinationName || ''} onChange={(event) => setForm({ ...form, combinationName: event.target.value })} /></label>
                <label className="admin-field">Description<input value={form.combinationDescription || ''} onChange={(event) => setForm({ ...form, combinationDescription: event.target.value })} /></label>
                <label className="admin-field">Source reference<input required value={form.combinationReference || ''} onChange={(event) => setForm({ ...form, combinationReference: event.target.value })} /></label>
                <button className="primary-button" disabled={busy}><CheckCircle2 size={15} /> Save combination</button>
            </form>
        </section>

        <section className="admin-panel">
            <p className="eyebrow">Subject mapping</p><h2>Add a source-backed subject</h2>
            <form className="admin-create-form" onSubmit={(event) => void submit(event, () => api.createCurriculumSubject({
                curriculumVersionId: form.subjectVersionId, educationLevelId: form.subjectLevelId, gradeId: form.subjectGradeId || null, programId: form.subjectProgramId || null, combinationId: form.subjectCombinationId || null, code: form.subjectCode, name: form.subjectName, description: form.subjectDescription, sourceReference: form.subjectReference,
            }), 'Curriculum subject mapping saved.', ['subjectCode', 'subjectName', 'subjectDescription', 'subjectReference'])}>
                <label className="admin-field">Curriculum version<select required value={form.subjectVersionId || ''} onChange={(event) => setForm({ ...form, subjectVersionId: event.target.value })}><option value="">Choose version</option>{versions.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}</select></label>
                <label className="admin-field">Education level<select required value={form.subjectLevelId || ''} onChange={(event) => setForm({ ...form, subjectLevelId: event.target.value, subjectGradeId: '' })}><option value="">Choose level</option>{levels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label className="admin-field">Class (optional)<select value={form.subjectGradeId || ''} onChange={(event) => setForm({ ...form, subjectGradeId: event.target.value })}><option value="">All classes at this level</option>{grades.filter((grade) => !form.subjectLevelId || grade.levelId === form.subjectLevelId).map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}</select></label>
                <label className="admin-field">Program (optional)<select value={form.subjectProgramId || ''} onChange={(event) => setForm({ ...form, subjectProgramId: event.target.value })}><option value="">No program</option>{taxonomy.programs.map((program) => <option key={value(program, 'id')} value={value(program, 'id')}>{value(program, 'name')}</option>)}</select></label>
                <label className="admin-field">Subject combination (optional)<select value={form.subjectCombinationId || ''} onChange={(event) => setForm({ ...form, subjectCombinationId: event.target.value })}><option value="">Common / no combination</option>{combinations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label className="admin-field">Subject code<input required value={form.subjectCode || ''} onChange={(event) => setForm({ ...form, subjectCode: event.target.value })} /></label>
                <label className="admin-field">Subject name<input required value={form.subjectName || ''} onChange={(event) => setForm({ ...form, subjectName: event.target.value })} /></label>
                <label className="admin-field">Description<input value={form.subjectDescription || ''} onChange={(event) => setForm({ ...form, subjectDescription: event.target.value })} /></label>
                <label className="admin-field">Source reference<input required value={form.subjectReference || ''} onChange={(event) => setForm({ ...form, subjectReference: event.target.value })} /></label>
                <button className="primary-button" disabled={busy}><CheckCircle2 size={15} /> Save subject mapping</button>
            </form>
        </section>

        <section className="admin-panel">
            <p className="eyebrow">Student enrollment</p><h2>Assign an active verified subject</h2>
            <form className="admin-create-form" onSubmit={(event) => void submit(event, () => api.enrollCurriculumSubject({ studentId: form.studentId, curriculumSubjectId: form.enrollmentSubjectId }), 'Student subject enrollment saved.', ['studentId', 'enrollmentSubjectId'])}>
                <label className="admin-field">Active student<select required value={form.studentId || ''} onChange={(event) => setForm({ ...form, studentId: event.target.value })}><option value="">Choose student</option>{students.map((student) => <option key={student.id} value={student.id}>{student.full_name} · {student.email}</option>)}</select></label>
                <label className="admin-field">Verified curriculum subject<select required value={form.enrollmentSubjectId || ''} onChange={(event) => setForm({ ...form, enrollmentSubjectId: event.target.value })}><option value="">Choose subject mapping</option>{mappedSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
                <button className="primary-button" disabled={busy || !registry.subjects.some((subject) => value(subject, 'verification_status') === 'verified')}><CheckCircle2 size={15} /> Enroll student</button>
            </form>
            <div className="admin-table">{registry.programs.filter((program) => Array.isArray(program.grade_ids) && program.grade_ids.length > 0 && value(program, 'curriculum_verification_status') !== 'verified').map((program) => <div className="admin-table-row" key={value(program, 'id')}>
                <div><strong>{value(program, 'name')}</strong><small>Current catalogue entry — not yet verified by an official curriculum source.</small>
                    <input aria-label={`Source reference for ${value(program, 'name')}`} placeholder="Official source URL or reference" value={sourceReference[value(program, 'id')] || ''} onChange={(event) => setSourceReference({ ...sourceReference, [value(program, 'id')]: event.target.value })} />
                </div>
                <button className="secondary-button" disabled={busy || !sourceReference[value(program, 'id')]?.trim()} onClick={() => void verifyProgram(program)}>Verify TVET program</button>
            </div>)}</div>
        </section>
        <section className="admin-panel">
            <p className="eyebrow">Student profile</p><h2>Assign a verified subject combination</h2>
            <form className="admin-create-form" onSubmit={(event) => void submit(event, () => api.updateStudentSubjectCombination(form.combinationStudentId, form.studentCombinationId || null), 'Student subject combination updated.', ['combinationStudentId', 'studentCombinationId'])}>
                <label className="admin-field">Active student<select required value={form.combinationStudentId || ''} onChange={(event) => setForm({ ...form, combinationStudentId: event.target.value })}><option value="">Choose student</option>{students.map((student) => <option key={student.id} value={student.id}>{student.full_name} · {student.email}</option>)}</select></label>
                <label className="admin-field">Active verified combination<select required value={form.studentCombinationId || ''} onChange={(event) => setForm({ ...form, studentCombinationId: event.target.value })}><option value="">Choose combination</option>{activeCombinations.map((combination) => <option key={value(combination, 'id')} value={value(combination, 'id')}>{value(combination, 'name')} · {value(combination, 'education_level_name')}</option>)}</select></label>
                <button className="primary-button" disabled={busy || activeCombinations.length === 0}><CheckCircle2 size={15} /> Assign combination</button>
            </form>
        </section>
        <section className="admin-panel admin-full-panel">
            <p className="eyebrow">Learning materials</p><h2>Publish an approved resource or school textbook</h2>
            <form className="admin-create-form" onSubmit={(event) => void submit(event, () => api.createCurriculumMaterial({
                curriculumVersionId: form.materialVersionId, educationLevelId: form.materialLevelId, gradeId: form.materialGradeId || null, programId: form.materialProgramId || null, subjectId: form.materialSubjectId || null, schoolId: form.materialSchoolId || null, materialType: form.materialType, title: form.materialTitle, publisher: form.materialPublisher, edition: form.materialEdition, url: form.materialUrl, sourceReference: form.materialReference,
            }), 'Approved learning material published and assigned.', ['materialTitle', 'materialPublisher', 'materialEdition', 'materialUrl', 'materialReference'])}>
                <label className="admin-field">Active verified version<select required value={form.materialVersionId || ''} onChange={(event) => setForm({ ...form, materialVersionId: event.target.value })}><option value="">Choose version</option>{verifiedVersions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label className="admin-field">Material type<select required value={form.materialType || 'textbook'} onChange={(event) => setForm({ ...form, materialType: event.target.value })}><option value="textbook">Textbook</option><option value="teacher_guide">Teacher guide</option><option value="worksheet">Worksheet</option><option value="digital">Digital resource</option><option value="other">Other</option></select></label>
                <label className="admin-field">Education level<select required value={form.materialLevelId || ''} onChange={(event) => setForm({ ...form, materialLevelId: event.target.value, materialGradeId: '' })}><option value="">Choose level</option>{levels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label className="admin-field">Class (optional)<select value={form.materialGradeId || ''} onChange={(event) => setForm({ ...form, materialGradeId: event.target.value })}><option value="">All classes at this level</option>{grades.filter((grade) => !form.materialLevelId || grade.levelId === form.materialLevelId).map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}</select></label>
                <label className="admin-field">Program (optional)<select value={form.materialProgramId || ''} onChange={(event) => setForm({ ...form, materialProgramId: event.target.value })}><option value="">No program</option>{taxonomy.programs.map((program) => <option key={value(program, 'id')} value={value(program, 'id')}>{value(program, 'name')}</option>)}</select></label>
                <label className="admin-field">Subject mapping (optional)<select value={form.materialSubjectId || ''} onChange={(event) => setForm({ ...form, materialSubjectId: event.target.value })}><option value="">No specific subject</option>{mappedSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
                <label className="admin-field">School-specific assignment (optional)<select value={form.materialSchoolId || ''} onChange={(event) => setForm({ ...form, materialSchoolId: event.target.value })}><option value="">Available to matching schools</option>{schools.filter((school) => value(school, 'status') === 'active').map((school) => <option key={value(school, 'id')} value={value(school, 'id')}>{value(school, 'name')}</option>)}</select></label>
                <label className="admin-field">Title<input required value={form.materialTitle || ''} onChange={(event) => setForm({ ...form, materialTitle: event.target.value })} /></label>
                <label className="admin-field">Publisher<input value={form.materialPublisher || ''} onChange={(event) => setForm({ ...form, materialPublisher: event.target.value })} /></label>
                <label className="admin-field">Edition<input value={form.materialEdition || ''} onChange={(event) => setForm({ ...form, materialEdition: event.target.value })} /></label>
                <label className="admin-field">Material URL<input required type="url" value={form.materialUrl || ''} onChange={(event) => setForm({ ...form, materialUrl: event.target.value })} /></label>
                <label className="admin-field">Official source reference<input required value={form.materialReference || ''} onChange={(event) => setForm({ ...form, materialReference: event.target.value })} /></label>
                <button className="primary-button" disabled={busy || verifiedVersions.length === 0}><CheckCircle2 size={15} /> Publish material</button>
            </form>
        </section>
        <section className="admin-panel admin-full-panel">
            <p className="eyebrow">Competency-based curriculum</p><h2>Manage class units and learning outcomes</h2>
            <div className="admin-two-column">
                <form className="admin-create-form" onSubmit={(event) => void submit(event, () => api.createCurriculumUnit({
                    curriculumSubjectId: form.curriculumUnitSubjectId, code: form.curriculumUnitCode, title: form.curriculumUnitTitle, description: form.curriculumUnitDescription, position: form.curriculumUnitPosition || '1', sourceReference: form.curriculumUnitReference,
                }), 'Curriculum unit saved as draft.', ['curriculumUnitCode', 'curriculumUnitTitle', 'curriculumUnitDescription', 'curriculumUnitReference'])}>
                    <strong>Add curriculum unit</strong>
                    <label className="admin-field">Active verified subject<select required value={form.curriculumUnitSubjectId || ''} onChange={(event) => setForm({ ...form, curriculumUnitSubjectId: event.target.value })}><option value="">Choose subject mapping</option>{verifiedCurriculumSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
                    <label className="admin-field">Unit code<input required value={form.curriculumUnitCode || ''} onChange={(event) => setForm({ ...form, curriculumUnitCode: event.target.value })} /></label>
                    <label className="admin-field">Unit title<input required value={form.curriculumUnitTitle || ''} onChange={(event) => setForm({ ...form, curriculumUnitTitle: event.target.value })} /></label>
                    <label className="admin-field">Description<input value={form.curriculumUnitDescription || ''} onChange={(event) => setForm({ ...form, curriculumUnitDescription: event.target.value })} /></label>
                    <label className="admin-field">Position<input required type="number" min="1" value={form.curriculumUnitPosition || '1'} onChange={(event) => setForm({ ...form, curriculumUnitPosition: event.target.value })} /></label>
                    <label className="admin-field">Source reference<input required value={form.curriculumUnitReference || ''} onChange={(event) => setForm({ ...form, curriculumUnitReference: event.target.value })} /></label>
                    <button className="primary-button" disabled={busy || !verifiedCurriculumSubjects.length}>Save draft unit</button>
                </form>
                <form className="admin-create-form" onSubmit={(event) => void submit(event, () => api.createCurriculumOutcome(form.curriculumUnitParentId, {
                    code: form.curriculumOutcomeCode, description: form.curriculumOutcomeDescription, position: form.curriculumOutcomePosition || '1', sourceReference: form.curriculumOutcomeReference,
                }), 'Learning outcome saved as draft.', ['curriculumOutcomeCode', 'curriculumOutcomeDescription', 'curriculumOutcomeReference'])}>
                    <strong>Add learning outcome</strong>
                    <label className="admin-field">Curriculum unit<select required value={form.curriculumUnitParentId || ''} onChange={(event) => setForm({ ...form, curriculumUnitParentId: event.target.value })}><option value="">Choose unit</option>{curriculumUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
                    <label className="admin-field">Outcome code<input required value={form.curriculumOutcomeCode || ''} onChange={(event) => setForm({ ...form, curriculumOutcomeCode: event.target.value })} /></label>
                    <label className="admin-field">Learning outcome<input required value={form.curriculumOutcomeDescription || ''} onChange={(event) => setForm({ ...form, curriculumOutcomeDescription: event.target.value })} /></label>
                    <label className="admin-field">Position<input required type="number" min="1" value={form.curriculumOutcomePosition || '1'} onChange={(event) => setForm({ ...form, curriculumOutcomePosition: event.target.value })} /></label>
                    <label className="admin-field">Source reference<input required value={form.curriculumOutcomeReference || ''} onChange={(event) => setForm({ ...form, curriculumOutcomeReference: event.target.value })} /></label>
                    <button className="primary-button" disabled={busy || !curriculumUnits.length}>Save draft outcome</button>
                </form>
            </div>
            <div className="admin-table">{[['units', registry.curriculumUnits], ['outcomes', registry.curriculumOutcomes]].flatMap(([type, rows]) => (rows as Row[]).map((row) => <div className="admin-table-row" key={`${type}-${value(row, 'id')}`}>
                <div><strong>{value(row, 'title') || value(row, 'description')}</strong><small>{String(type)} · {value(row, 'status')}</small></div>
                <button className="secondary-button" disabled={busy || value(row, 'status') === 'published'} onClick={() => void setCurriculumStatus(String(type), value(row, 'id'), 'published')}>Publish</button>
                <button className="secondary-button" disabled={busy || value(row, 'status') !== 'published'} onClick={() => void setCurriculumStatus(String(type), value(row, 'id'), 'draft')}>Unpublish</button>
            </div>))}</div>
        </section>
        <section className="admin-panel admin-full-panel">
            <p className="eyebrow">TVET curriculum</p><h2>Manage verified program modules and outcomes</h2>
            <p className="admin-empty">New records stay in draft until an administrator publishes them. Student dashboards only show published records attached to an active verified curriculum.</p>
            <div className="admin-two-column">
                <form className="admin-create-form" onSubmit={(event) => void submit(event, () => api.createTvetSubject({
                    programId: form.tvetProgramId, gradeId: form.tvetGradeId, curriculumVersionId: form.tvetVersionId, code: form.tvetSubjectCode, name: form.tvetSubjectName, description: form.tvetSubjectDescription, sourceReference: form.tvetSubjectReference,
                }), 'TVET subject saved as draft.', ['tvetSubjectCode', 'tvetSubjectName', 'tvetSubjectDescription', 'tvetSubjectReference'])}>
                    <strong>Add TVET subject</strong>
                    <label className="admin-field">Verified program<select required value={form.tvetProgramId || ''} onChange={(event) => setForm({ ...form, tvetProgramId: event.target.value })}><option value="">Choose program</option>{tvetPrograms.map((program) => <option key={value(program, 'id')} value={value(program, 'id')}>{value(program, 'name')}</option>)}</select></label>
                    <label className="admin-field">TVET level<select required value={form.tvetGradeId || ''} onChange={(event) => setForm({ ...form, tvetGradeId: event.target.value })}><option value="">Choose level</option>{tvetGrades.filter((grade) => !form.tvetProgramId || selectedTvetGradeIds.includes(value(grade, 'id'))).map((grade) => <option key={value(grade, 'id')} value={value(grade, 'id')}>{value(grade, 'name')}</option>)}</select></label>
                    <label className="admin-field">Active verified curriculum version<select required value={form.tvetVersionId || ''} onChange={(event) => setForm({ ...form, tvetVersionId: event.target.value })}><option value="">Choose version</option>{verifiedVersions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                    <label className="admin-field">Code<input required value={form.tvetSubjectCode || ''} onChange={(event) => setForm({ ...form, tvetSubjectCode: event.target.value })} /></label>
                    <label className="admin-field">Subject name<input required value={form.tvetSubjectName || ''} onChange={(event) => setForm({ ...form, tvetSubjectName: event.target.value })} /></label>
                    <label className="admin-field">Description<input value={form.tvetSubjectDescription || ''} onChange={(event) => setForm({ ...form, tvetSubjectDescription: event.target.value })} /></label>
                    <label className="admin-field">Source reference<input required value={form.tvetSubjectReference || ''} onChange={(event) => setForm({ ...form, tvetSubjectReference: event.target.value })} /></label>
                    <button className="primary-button" disabled={busy || tvetPrograms.length === 0 || verifiedVersions.length === 0}>Save draft subject</button>
                </form>
                <form className="admin-create-form" onSubmit={(event) => void submit(event, () => api.createTvetCompetence(form.tvetSubjectParentId, {
                    code: form.tvetCompetenceCode, title: form.tvetCompetenceTitle, description: form.tvetCompetenceDescription,
                }), 'TVET competency saved as draft.', ['tvetCompetenceCode', 'tvetCompetenceTitle', 'tvetCompetenceDescription'])}>
                    <strong>Add competence</strong>
                    <label className="admin-field">TVET subject<select required value={form.tvetSubjectParentId || ''} onChange={(event) => setForm({ ...form, tvetSubjectParentId: event.target.value })}><option value="">Choose subject</option>{tvetSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
                    <label className="admin-field">Code<input required value={form.tvetCompetenceCode || ''} onChange={(event) => setForm({ ...form, tvetCompetenceCode: event.target.value })} /></label>
                    <label className="admin-field">Competence title<input required value={form.tvetCompetenceTitle || ''} onChange={(event) => setForm({ ...form, tvetCompetenceTitle: event.target.value })} /></label>
                    <label className="admin-field">Description<input value={form.tvetCompetenceDescription || ''} onChange={(event) => setForm({ ...form, tvetCompetenceDescription: event.target.value })} /></label>
                    <button className="primary-button" disabled={busy || !tvetSubjects.length}>Save draft competence</button>
                </form>
                <form className="admin-create-form" onSubmit={(event) => void submit(event, () => api.createTvetModule(form.tvetCompetenceParentId, {
                    title: form.tvetModuleTitle, description: form.tvetModuleDescription, position: form.tvetModulePosition || '1',
                }), 'TVET module saved as draft.', ['tvetModuleTitle', 'tvetModuleDescription'])}>
                    <strong>Add module</strong>
                    <label className="admin-field">Competence<select required value={form.tvetCompetenceParentId || ''} onChange={(event) => setForm({ ...form, tvetCompetenceParentId: event.target.value })}><option value="">Choose competence</option>{tvetCompetences.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                    <label className="admin-field">Title<input required value={form.tvetModuleTitle || ''} onChange={(event) => setForm({ ...form, tvetModuleTitle: event.target.value })} /></label>
                    <label className="admin-field">Description<input value={form.tvetModuleDescription || ''} onChange={(event) => setForm({ ...form, tvetModuleDescription: event.target.value })} /></label>
                    <label className="admin-field">Position<input required type="number" min="1" value={form.tvetModulePosition || '1'} onChange={(event) => setForm({ ...form, tvetModulePosition: event.target.value })} /></label>
                    <button className="primary-button" disabled={busy || !tvetCompetences.length}>Save draft module</button>
                </form>
                <form className="admin-create-form" onSubmit={(event) => void submit(event, () => api.createTvetUnit(form.tvetModuleParentId, {
                    title: form.tvetUnitTitle, description: form.tvetUnitDescription, position: form.tvetUnitPosition || '1',
                }), 'TVET unit saved as draft.', ['tvetUnitTitle', 'tvetUnitDescription'])}>
                    <strong>Add unit</strong>
                    <label className="admin-field">Module<select required value={form.tvetModuleParentId || ''} onChange={(event) => setForm({ ...form, tvetModuleParentId: event.target.value })}><option value="">Choose module</option>{tvetModules.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                    <label className="admin-field">Title<input required value={form.tvetUnitTitle || ''} onChange={(event) => setForm({ ...form, tvetUnitTitle: event.target.value })} /></label>
                    <label className="admin-field">Description<input value={form.tvetUnitDescription || ''} onChange={(event) => setForm({ ...form, tvetUnitDescription: event.target.value })} /></label>
                    <label className="admin-field">Position<input required type="number" min="1" value={form.tvetUnitPosition || '1'} onChange={(event) => setForm({ ...form, tvetUnitPosition: event.target.value })} /></label>
                    <button className="primary-button" disabled={busy || !tvetModules.length}>Save draft unit</button>
                </form>
                <form className="admin-create-form" onSubmit={(event) => void submit(event, () => api.createTvetOutcome(form.tvetUnitParentId, {
                    code: form.tvetOutcomeCode, description: form.tvetOutcomeDescription, position: form.tvetOutcomePosition || '1', sourceReference: form.tvetOutcomeReference,
                }), 'TVET learning outcome saved as draft.', ['tvetOutcomeCode', 'tvetOutcomeDescription', 'tvetOutcomeReference'])}>
                    <strong>Add learning outcome</strong>
                    <label className="admin-field">Unit<select required value={form.tvetUnitParentId || ''} onChange={(event) => setForm({ ...form, tvetUnitParentId: event.target.value })}><option value="">Choose unit</option>{tvetUnits.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                    <label className="admin-field">Code<input required value={form.tvetOutcomeCode || ''} onChange={(event) => setForm({ ...form, tvetOutcomeCode: event.target.value })} /></label>
                    <label className="admin-field">Outcome<input required value={form.tvetOutcomeDescription || ''} onChange={(event) => setForm({ ...form, tvetOutcomeDescription: event.target.value })} /></label>
                    <label className="admin-field">Source reference<input required value={form.tvetOutcomeReference || ''} onChange={(event) => setForm({ ...form, tvetOutcomeReference: event.target.value })} /></label>
                    <label className="admin-field">Position<input required type="number" min="1" value={form.tvetOutcomePosition || '1'} onChange={(event) => setForm({ ...form, tvetOutcomePosition: event.target.value })} /></label>
                    <button className="primary-button" disabled={busy || !tvetUnits.length}>Save draft outcome</button>
                </form>
            </div>
            <div className="admin-table">
                {[['subjects', registry.tvetSubjects], ['competences', registry.tvetCompetences], ['modules', registry.tvetModules], ['units', registry.tvetUnits], ['outcomes', registry.tvetOutcomes]].flatMap(([type, rows]) => (rows as Row[]).map((row) => <div className="admin-table-row" key={`${type}-${value(row, 'id')}`}>
                    <div><strong>{value(row, 'title') || value(row, 'name') || value(row, 'description')}</strong><small>{String(type)} · {value(row, 'status')}</small></div>
                    <button className="secondary-button" disabled={busy || value(row, 'status') === 'published'} onClick={() => void setTvetStatus(String(type), value(row, 'id'), 'published')}>Publish</button>
                    <button className="secondary-button" disabled={busy || value(row, 'status') !== 'published'} onClick={() => void setTvetStatus(String(type), value(row, 'id'), 'draft')}>Unpublish</button>
                </div>))}
            </div>
        </section>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {success && <div className="saved-notice" role="status">{success}</div>}
    </div>
}
