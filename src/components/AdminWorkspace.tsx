import { useEffect, useState, type FormEvent } from 'react'
import { Archive, Check, ChevronRight, FileText, LayoutDashboard, Plus, RefreshCw, ShieldCheck, Trash2, Users } from 'lucide-react'
import { api } from '../lib/api'
import type { AppRole } from '../security/authorization'

type RecordValue = Record<string, unknown>
type AdminWorkspaceProps = { role: AppRole }
type Taxonomy = { levels: RecordValue[]; grades: RecordValue[]; programs: RecordValue[]; subjects: RecordValue[] }

const contentTabs = [
    ['Education Levels', 'levels'], ['Classes', 'grades'], ['Programs', 'programs'], ['Subjects', 'subjects'],
    ['Courses', 'courses'], ['Modules', 'modules'], ['Lessons', 'lessons'], ['Lesson notes', 'notes'],
    ['Examples', 'examples'], ['Exercises', 'exercises'], ['Homework', 'assignments'], ['Quizzes', 'quizzes'], ['Tests', 'tests'], ['Exams', 'exams'],
] as const
const tabs = [['Dashboard', 'dashboard'], ...contentTabs, ['Teachers', 'teachers'], ['Teacher Verification', 'verification'], ['Students', 'students'], ['AI Tutor', 'ai'], ['Settings', 'settings'], ['Audit Logs', 'audit']] as const

function text(value: unknown) { return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value) }
function titleFor(record: RecordValue) { return text(record.title || record.name || record.prompt || 'Untitled') }

export default function AdminWorkspace({ role }: AdminWorkspaceProps) {
    const [tab, setTab] = useState('dashboard')
    const [overview, setOverview] = useState<RecordValue | null>(null)
    const [taxonomy, setTaxonomy] = useState<Taxonomy>({ levels: [], grades: [], programs: [], subjects: [] })
    const [contentOptions, setContentOptions] = useState<{ courses: RecordValue[]; modules: RecordValue[]; lessons: RecordValue[] }>({ courses: [], modules: [], lessons: [] })
    const [rows, setRows] = useState<RecordValue[]>([])
    const [teachers, setTeachers] = useState<RecordValue[]>([])
    const [users, setUsers] = useState<RecordValue[]>([])
    const [auditLogs, setAuditLogs] = useState<RecordValue[]>([])
    const [form, setForm] = useState<RecordValue>({})
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')

    async function loadReferences() {
        const [taxonomyResult, teacherResult, userResult, coursesResult, modulesResult, lessonsResult] = await Promise.all([api.adminTaxonomy(), api.adminTeachers(), api.adminUsers(), api.adminContent('courses'), api.adminContent('modules'), api.adminContent('lessons')])
        setTaxonomy(taxonomyResult.data)
        setTeachers(teacherResult.data)
        setUsers(userResult.data)
        setContentOptions({ courses: coursesResult.data, modules: modulesResult.data, lessons: lessonsResult.data })
    }
    async function loadTab(nextTab = tab) {
        setError('')
        if (nextTab === 'dashboard') { setOverview((await api.adminOverview()).data); return }
        if (nextTab === 'teachers' || nextTab === 'verification') { setTeachers((await api.adminTeachers()).data); return }
        if (nextTab === 'students') { setUsers((await api.adminUsers()).data.filter((user) => user.role === 'student')); return }
        if (nextTab === 'audit') { setAuditLogs((await api.adminAuditLogs()).data); return }
        const content = contentTabs.find((item) => item[1] === nextTab)
        if (content) setRows((await api.adminContent(content[1])).data)
    }
    useEffect(() => { void loadReferences().catch((caught) => setError(caught instanceof Error ? caught.message : 'Admin data could not be loaded')); void loadTab().catch((caught) => setError(caught instanceof Error ? caught.message : 'Admin data could not be loaded')) }, [tab])
    function select(nextTab: string) { setTab(nextTab); setForm({}) }
    function setField(name: string, value: unknown) { setForm((current) => ({ ...current, [name]: value })) }
    async function create(event: FormEvent) {
        event.preventDefault()
        if (!contentTabs.some((item) => item[1] === tab)) return
        setBusy(true); setError('')
        try { await api.createAdminContent(tab, form); setForm({}); await loadTab(tab) } catch (caught) { setError(caught instanceof Error ? caught.message : 'Content could not be created') } finally { setBusy(false) }
    }
    async function changeStatus(id: string, nextStatus: string) {
        setBusy(true); setError('')
        try { await api.setAdminContentStatus(tab, id, nextStatus); await loadTab(tab) } catch (caught) { setError(caught instanceof Error ? caught.message : 'Status could not be changed') } finally { setBusy(false) }
    }
    async function remove(id: string) {
        if (!window.confirm('Delete this item permanently?')) return
        setBusy(true); setError('')
        try { await api.deleteAdminContent(tab, id); await loadTab(tab) } catch (caught) { setError(caught instanceof Error ? caught.message : 'Content could not be deleted') } finally { setBusy(false) }
    }
    const content = contentTabs.find((item) => item[1] === tab)
    return <div className="admin-page">
        <div className="admin-heading"><div><p className="eyebrow">{role === 'super-admin' ? 'Super Admin CMS' : 'Admin CMS'}</p><h1>Curriculum control center</h1><p>One source of truth for published learning content and configuration.</p></div><button className="secondary-button" onClick={() => void loadTab()} disabled={busy}><RefreshCw size={15} /> Refresh</button></div>
        <nav className="admin-tabs" aria-label="Admin sections">{tabs.map(([label, value]) => <button key={value} className={tab === value ? 'active' : ''} onClick={() => select(value)}>{value === 'dashboard' ? <LayoutDashboard size={16} /> : value === 'teachers' || value === 'verification' || value === 'students' ? <Users size={16} /> : value === 'audit' ? <FileText size={16} /> : value === 'settings' ? <ShieldCheck size={16} /> : <ChevronRight size={16} />}{label}</button>)}</nav>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {tab === 'dashboard' && <Overview data={overview} />}
        {content && <ContentSection label={content[0]} type={content[1]} rows={rows} form={form} busy={busy} taxonomy={taxonomy} teachers={teachers} options={contentOptions} setField={setField} create={create} changeStatus={changeStatus} remove={remove} />}
        {tab === 'teachers' && <TeacherSection teachers={teachers} verify={async (id, status) => { await api.verifyTeacher(id, status); await loadTab(tab) }} />}
        {tab === 'verification' && <TeacherSection teachers={teachers} verify={async (id, status) => { await api.verifyTeacher(id, status); await loadTab(tab) }} verification />}
        {tab === 'students' && <UsersSection users={users} />}
        {tab === 'ai' && <section className="admin-panel admin-full-panel"><p className="eyebrow">AI Tutor governance</p><h2>AI drafts remain reviewable</h2><p>Teacher and AI-generated material must be saved as draft content and published through this CMS before students can see it.</p></section>}
        {tab === 'settings' && <section className="admin-panel admin-full-panel"><p className="eyebrow">Platform settings</p><h2>Publishing policy</h2><p>Students receive only published content that matches their education level, class, and program profile.</p></section>}
        {tab === 'audit' && <AuditSection rows={auditLogs} />}
    </div>
}

function Overview({ data }: { data: RecordValue | null }) {
    const stats = [['Students', data?.students], ['Teachers', data?.teachers], ['Courses', data?.courses], ['Subjects', data?.subjects], ['Published courses', data?.published_courses], ['Published lessons', data?.published_lessons], ['Draft courses', data?.draft_courses], ['Pending teachers', data?.pending_teachers]]
    return <section className="admin-stats">{stats.map(([label, value]) => <article className="stat-card" key={String(label)}><div className="stat-icon blue"><LayoutDashboard size={18} /></div><div><span>{String(label)}</span><strong>{value === undefined ? '...' : String(value)}</strong><small>Database total</small></div></article>)}</section>
}

function ContentSection({ label, type, rows, form, busy, taxonomy, teachers, options, setField, create, changeStatus, remove }: { label: string; type: string; rows: RecordValue[]; form: RecordValue; busy: boolean; taxonomy: Taxonomy; teachers: RecordValue[]; options: { courses: RecordValue[]; modules: RecordValue[]; lessons: RecordValue[] }; setField: (name: string, value: unknown) => void; create: (event: FormEvent) => void; changeStatus: (id: string, status: string) => Promise<void>; remove: (id: string) => Promise<void> }) {
    return <div className="admin-two-column"><section className="admin-panel"><div className="section-heading compact"><div><p className="eyebrow">Curriculum source of truth</p><h2>{label}</h2></div><span className="status-pill published">{rows.length} records</span></div><div className="admin-table">{rows.map((row) => <div className="admin-table-row" key={text(row.id)}><div><strong>{titleFor(row)}</strong><small>{text(row.course || row.module || row.lesson || row.subject || row.education_level_name)}</small></div><span className={`status-pill ${row.status === 'published' ? 'published' : row.status === 'archived' ? 'rejected' : 'draft'}`}>{text(row.status || 'configured')}</span><div className="admin-table-actions">{Boolean(row.status) && text(row.status) !== 'published' && <button onClick={() => void changeStatus(text(row.id), 'published')}>Publish</button>}{row.status === 'published' && <button onClick={() => void changeStatus(text(row.id), 'archived')}><Archive size={14} /> Archive</button>}{row.status === 'archived' && <button onClick={() => void changeStatus(text(row.id), 'draft')}>Restore</button>}<button onClick={() => void remove(text(row.id))} aria-label={`Delete ${titleFor(row)}`}><Trash2 size={14} /></button></div></div>)}{!rows.length && <p className="admin-empty">No records yet. Create the first item below.</p>}</div></section><section className="admin-panel"><p className="eyebrow">Create {label.toLowerCase()}</p><h2>New record</h2><form className="admin-create-form" onSubmit={create}>{fieldsFor(type, form, taxonomy, teachers, options, setField)}<button className="primary-button" disabled={busy} type="submit"><Plus size={15} /> Create draft</button></form></section></div>
}

function Field({ label, name, value, setField, options }: { label: string; name: string; value: unknown; setField: (name: string, value: unknown) => void; options?: Array<{ value: string; label: string }> }) { return <label className="admin-field">{label}{options ? <select required value={text(value)} onChange={(event) => setField(name, event.target.value)}><option value="">Choose {label.toLowerCase()}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input required value={text(value)} onChange={(event) => setField(name, event.target.value)} />}</label> }
function fieldsFor(type: string, form: RecordValue, taxonomy: Taxonomy, teachers: RecordValue[], options: { courses: RecordValue[]; modules: RecordValue[]; lessons: RecordValue[] }, setField: (name: string, value: unknown) => void) {
    const levelOptions = taxonomy.levels.map((item) => ({ value: text(item.id), label: text(item.name) }))
    const gradeOptions = taxonomy.grades.map((item) => ({ value: text(item.id), label: `${text(item.name)} · ${text(item.education_level_name)}` }))
    const subjectOptions = taxonomy.subjects.map((item) => ({ value: text(item.id), label: text(item.name) }))
    const teacherOptions = teachers.map((item) => ({ value: text(item.id), label: text(item.full_name) }))
    const courseOptions = options.courses.map((item) => ({ value: text(item.id), label: text(item.title) }))
    const moduleOptions = options.modules.map((item) => ({ value: text(item.id), label: `${text(item.title)} · ${text(item.course)}` }))
    const lessonOptions = options.lessons.map((item) => ({ value: text(item.id), label: `${text(item.title)} · ${text(item.module)}` }))
    if (type === 'levels') return <><Field label="Name" name="name" value={form.name} setField={setField} /><Field label="Code" name="code" value={form.code} setField={setField} /><Field label="Position" name="position" value={form.position || 0} setField={setField} /></>
    if (type === 'grades') return <><Field label="Education level" name="educationLevelId" value={form.educationLevelId} setField={setField} options={levelOptions} /><Field label="Name" name="name" value={form.name} setField={setField} /><Field label="Code" name="code" value={form.code} setField={setField} /></>
    if (type === 'programs') return <><Field label="Name" name="name" value={form.name} setField={setField} /><Field label="Description" name="description" value={form.description} setField={setField} /></>
    if (type === 'subjects') return <><Field label="Name" name="name" value={form.name} setField={setField} /><Field label="Education level" name="educationLevelId" value={form.educationLevelId} setField={setField} options={levelOptions} /><Field label="Class" name="gradeId" value={form.gradeId} setField={setField} options={gradeOptions} /></>
    if (type === 'courses') return <><Field label="Title" name="title" value={form.title} setField={setField} /><Field label="Teacher" name="teacherId" value={form.teacherId} setField={setField} options={teacherOptions} /><Field label="Subject" name="subjectId" value={form.subjectId} setField={setField} options={subjectOptions} /><Field label="Education level" name="educationLevelId" value={form.educationLevelId} setField={setField} options={levelOptions} /><Field label="Class" name="gradeId" value={form.gradeId} setField={setField} options={gradeOptions} /><Field label="Description" name="description" value={form.description} setField={setField} /></>
    if (type === 'modules') return <><Field label="Course" name="courseId" value={form.courseId} setField={setField} options={courseOptions} /><Field label="Title" name="title" value={form.title} setField={setField} /><Field label="Position" name="position" value={form.position || 0} setField={setField} /></>
    if (type === 'lessons') return <><Field label="Module" name="moduleId" value={form.moduleId} setField={setField} options={moduleOptions} /><Field label="Title" name="title" value={form.title} setField={setField} /><Field label="Duration minutes" name="durationMinutes" value={form.durationMinutes || 1} setField={setField} /><Field label="Position" name="position" value={form.position || 0} setField={setField} /></>
    if (type === 'notes' || type === 'examples') return <><Field label="Lesson" name="lessonId" value={form.lessonId} setField={setField} options={lessonOptions} /><Field label="Title" name="title" value={form.title} setField={setField} /><Field label="Body" name="body" value={form.body} setField={setField} /></>
    if (type === 'exercises') return <><Field label="Lesson" name="lessonId" value={form.lessonId} setField={setField} options={lessonOptions} /><Field label="Prompt" name="prompt" value={form.prompt} setField={setField} /><Field label="Answer" name="answer" value={form.answer} setField={setField} /></>
    if (type === 'assignments') return <><Field label="Course" name="courseId" value={form.courseId} setField={setField} options={courseOptions} /><Field label="Teacher" name="teacherId" value={form.teacherId} setField={setField} options={teacherOptions} /><Field label="Title" name="title" value={form.title} setField={setField} /><Field label="Instructions" name="instructions" value={form.instructions} setField={setField} /><Field label="Due date" name="dueAt" value={form.dueAt} setField={setField} /><Field label="Total marks" name="totalMarks" value={form.totalMarks || 100} setField={setField} /></>
    return <><Field label="Course ID" name="courseId" value={form.courseId} setField={setField} /><Field label="Title" name="title" value={form.title} setField={setField} /><Field label="Time limit seconds" name="timeLimitSeconds" value={form.timeLimitSeconds || 60} setField={setField} /></>
}

function TeacherSection({ teachers, verify, verification = false }: { teachers: RecordValue[]; verify: (id: string, status: string) => Promise<void>; verification?: boolean }) { return <section className="admin-panel admin-full-panel"><div className="section-heading compact"><div><p className="eyebrow">{verification ? 'Governance' : 'Teacher accounts'}</p><h2>{verification ? 'Teacher verification queue' : 'Teachers and permissions'}</h2></div></div>{teachers.map((teacher) => <div className="admin-table-row" key={text(teacher.id)}><div><strong>{text(teacher.full_name)}</strong><small>{text(teacher.email)} · Permissions: {text(teacher.permissions) || 'none'}</small></div><span className={`status-pill ${teacher.verification_status === 'active' ? 'published' : 'draft'}`}>{text(teacher.verification_status)}</span><div className="admin-table-actions"><button onClick={() => void verify(text(teacher.id), 'active')}><Check size={14} /> Verify</button><button onClick={() => void verify(text(teacher.id), 'suspended')}>Suspend</button></div></div>)}{!teachers.length && <p className="admin-empty">No teachers found.</p>}</section> }
function UsersSection({ users }: { users: RecordValue[] }) { return <section className="admin-panel admin-full-panel"><p className="eyebrow">Student accounts</p><h2>Students</h2>{users.map((user) => <div className="admin-table-row" key={text(user.id)}><div><strong>{text(user.full_name)}</strong><small>{text(user.email)}</small></div><span className="status-pill published">{text(user.status)}</span><span>{text(user.created_at)}</span></div>)}{!users.length && <p className="admin-empty">No students found.</p>}</section> }
function AuditSection({ rows }: { rows: RecordValue[] }) { return <section className="admin-panel admin-full-panel"><p className="eyebrow">Immutable history</p><h2>Audit logs</h2>{rows.map((row) => <div className="audit-row" key={text(row.id)}><strong>{text(row.action)}</strong><span>{text(row.entity_type)} · {text(row.entity_id)}</span><small>{text(row.created_at)}</small></div>)}{!rows.length && <p className="admin-empty">No admin actions recorded yet.</p>}</section> }
