import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Archive, Check, ChevronRight, FileText, LayoutDashboard, Plus, RefreshCw, Search, ShieldCheck, Trash2, Users } from 'lucide-react'
import { api } from '../lib/api'
import type { AppRole } from '../security/authorization'

type RecordValue = Record<string, unknown>
type AdminWorkspaceProps = { role: AppRole; navigationTargetId?: string }
type Taxonomy = { levels: RecordValue[]; grades: RecordValue[]; programs: RecordValue[]; subjects: RecordValue[] }

const contentTabs = [
    ['Education Levels', 'levels'], ['Classes', 'grades'], ['Programs', 'programs'], ['Subjects', 'subjects'],
    ['Courses', 'courses'], ['Modules', 'modules'], ['Lessons', 'lessons'], ['Lesson notes', 'notes'],
    ['Examples', 'examples'], ['Exercises', 'exercises'], ['Homework', 'assignments'], ['Quizzes', 'quizzes'], ['Tests', 'tests'], ['Exams', 'exams'],
] as const
const tabs = [['Dashboard', 'dashboard'], ['Schools', 'schools'], ...contentTabs, ['Teachers', 'teachers'], ['Teacher Verification', 'verification'], ['Content Review', 'review'], ['Users', 'students'], ['AI Tutor', 'ai'], ['Settings', 'settings'], ['Audit Logs', 'audit']] as const

function text(value: unknown) { return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value) }
function titleFor(record: RecordValue) { return text(record.title || record.name || record.prompt || 'Untitled') }

export default function AdminWorkspace({ role, navigationTargetId }: AdminWorkspaceProps) {
    const [tab, setTab] = useState('dashboard')
    const [overview, setOverview] = useState<RecordValue | null>(null)
    const [taxonomy, setTaxonomy] = useState<Taxonomy>({ levels: [], grades: [], programs: [], subjects: [] })
    const [contentOptions, setContentOptions] = useState<{ courses: RecordValue[]; modules: RecordValue[]; lessons: RecordValue[] }>({ courses: [], modules: [], lessons: [] })
    const [rows, setRows] = useState<RecordValue[]>([])
    const [teachers, setTeachers] = useState<RecordValue[]>([])
    const [users, setUsers] = useState<RecordValue[]>([])
    const [userTotal, setUserTotal] = useState(0)
    const [userFilters, setUserFilters] = useState({ role: '', status: '' })
    const [auditLogs, setAuditLogs] = useState<RecordValue[]>([])
    const [reviewRows, setReviewRows] = useState<RecordValue[]>([])
    const [form, setForm] = useState<RecordValue>({})
    const [filters, setFilters] = useState({ search: '', level: '', grade: '', program: '', subject: '', offset: 0 })
    const [totalRows, setTotalRows] = useState(0)
    const [busy, setBusy] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
    const [composerOpen, setComposerOpen] = useState(false)

    async function loadReferences() {
        const [taxonomyResult, teacherResult] = await Promise.all([api.adminTaxonomy(), api.adminTeachers()])
        setTaxonomy(taxonomyResult.data)
        setTeachers(teacherResult.data)
    }
    async function loadTab(nextTab = tab) {
        setError('')
        setLoading(true)
        try {
            if (nextTab === 'dashboard') { setOverview((await api.adminOverview()).data); return }
            if (nextTab === 'teachers' || nextTab === 'verification') { setTeachers((await api.adminTeachers()).data); return }
            if (nextTab === 'review') { setReviewRows((await api.adminReview()).data); return }
            if (nextTab === 'students') {
                const result = await api.adminUsers({ ...userFilters, search: filters.search, limit: 100, offset: filters.offset })
                setUsers(result.data)
                setUserTotal(result.meta.total)
                return
            }
            if (nextTab === 'audit') { setAuditLogs((await api.adminAuditLogs()).data); return }
            const content = contentTabs.find((item) => item[1] === nextTab)
            if (content) {
                const result = await api.adminContent(content[1], { ...filters, limit: 100 })
                setRows(result.data)
                setTotalRows(result.meta?.total ?? result.data.length)
            }
        } finally { setLoading(false) }
    }
    useEffect(() => { void loadReferences().catch((caught) => setError(caught instanceof Error ? caught.message : 'Admin data could not be loaded')) }, [])
    useEffect(() => { const timer = window.setTimeout(() => { void loadTab().catch((caught) => setError(caught instanceof Error ? caught.message : 'Admin data could not be loaded')) }, filters.search ? 250 : 0); return () => window.clearTimeout(timer) }, [tab, filters, userFilters])
    useEffect(() => {
        const level = String(form.educationLevelId || '')
        const grade = String(form.gradeId || '')
        if (!level || !grade) { setContentOptions({ courses: [], modules: [], lessons: [] }); return }
        const scope = { level, grade, program: form.programId ? String(form.programId) : undefined, subject: form.subjectId ? String(form.subjectId) : undefined, limit: 200 }
        Promise.all([api.adminContent('courses', scope), api.adminContent('modules', scope), api.adminContent('lessons', scope)])
            .then(([courses, modules, lessons]) => setContentOptions({ courses: courses.data, modules: modules.data, lessons: lessons.data }))
            .catch((caught) => setError(caught instanceof Error ? caught.message : 'Target content could not be loaded'))
    }, [form.educationLevelId, form.gradeId, form.programId, form.subjectId])
    function select(nextTab: string) { setTab(nextTab); setForm({}); setFilters({ search: '', level: '', grade: '', program: '', subject: '', offset: 0 }); setUserFilters({ role: '', status: '' }); setSuccess('') }
    function setField(name: string, value: unknown) { setForm((current) => ({ ...current, [name]: value })) }
    async function create(event: FormEvent | null, publish = false) {
        if (event) event.preventDefault()
        if (!contentTabs.some((item) => item[1] === tab)) return
        setBusy(true); setError('')
        const payload = { ...form, programId: form.programId === 'none' ? null : form.programId, ...(tab === 'assignments' && form.dueAt ? { dueAt: new Date(text(form.dueAt)).toISOString() } : {}) }
        try {
            const result = await api.createAdminContent(tab, payload)
            if (publish && result.data?.id) {
                await api.setAdminContentStatus(tab, String(result.data.id), 'published')
            }
            setForm({}); setComposerOpen(false); setSuccess('Content saved successfully.'); await loadTab(tab)
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'Content could not be created') } finally { setBusy(false) }
    }
    async function changeStatus(id: string, nextStatus: string) {
        setBusy(true); setError('')
        try { await api.setAdminContentStatus(tab, id, nextStatus); setSuccess('Content status updated.'); await loadTab(tab) } catch (caught) { setError(caught instanceof Error ? caught.message : 'Status could not be changed') } finally { setBusy(false) }
    }
    async function remove(id: string) {
        if (!window.confirm('Delete this item permanently?')) return
        setBusy(true); setError('')
        try { await api.deleteAdminContent(tab, id); setSuccess('Content deleted.'); await loadTab(tab) } catch (caught) { setError(caught instanceof Error ? caught.message : 'Content could not be deleted') } finally { setBusy(false) }
    }
    async function updateUserStatus(user: RecordValue) {
        const nextStatus = user.status === 'active' ? 'suspended' : 'active'
        setBusy(true); setError(''); setSuccess('')
        try { await api.updateAdminUserStatus(text(user.id), nextStatus); setSuccess(`User ${nextStatus === 'active' ? 'activated' : 'suspended'}.`); await loadTab('students') } catch (caught) { setError(caught instanceof Error ? caught.message : 'User status could not be changed') } finally { setBusy(false) }
    }
    const content = contentTabs.find((item) => item[1] === tab)
    const navigation = <nav className={navigationTargetId ? 'nav' : 'admin-tabs'} aria-label="Admin sections">{tabs.map(([label, value]) => <a key={value} href={`#${value}`} aria-current={tab === value ? 'page' : undefined} onClick={(event) => { event.preventDefault(); select(value) }}>{value === 'dashboard' ? <LayoutDashboard size={16} /> : value === 'teachers' || value === 'verification' || value === 'students' ? <Users size={16} /> : value === 'audit' ? <FileText size={16} /> : value === 'settings' ? <ShieldCheck size={16} /> : <ChevronRight size={16} />}{label}</a>)}</nav>
    const navigationTarget = navigationTargetId ? document.getElementById(navigationTargetId) : null
    return <>
        {navigationTargetId ? navigationTarget ? createPortal(navigation, navigationTarget) : null : navigation}
        <div className="admin-page">
        <div className="admin-heading"><div><p className="eyebrow">{role === 'super-admin' ? 'Super Admin CMS' : 'Admin CMS'}</p><h1>Curriculum control center</h1><p>Manage learning content by its exact education path.</p></div><div className="admin-heading-actions"><button className="secondary-button" onClick={() => void loadTab()} disabled={busy}><RefreshCw size={15} /> Refresh</button><button className="primary-button admin-primary-cta" onClick={() => { const next = content ? tab : 'courses'; if (!content) setTab(next); setComposerOpen(true); window.setTimeout(() => document.getElementById('admin-content-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0) }}><Plus size={16} /> Add Content</button></div></div>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {success && <div className="saved-notice" role="status">{success}</div>}
        {loading && <div className="admin-empty" role="status">Loading current database records...</div>}
        {tab === 'dashboard' && <Overview data={overview} />}
        {content && <ContentSection label={content[0]} type={content[1]} rows={rows} totalRows={totalRows} form={form} filters={filters} setFilters={setFilters} busy={busy} taxonomy={taxonomy} teachers={teachers} options={contentOptions} setField={setField} create={create} update={async (id, input) => { await api.updateAdminContent(tab, id, input); await loadTab(tab) }} changeStatus={changeStatus} remove={remove} composerOpen={composerOpen} setComposerOpen={setComposerOpen} />}
        {tab === 'schools' && <section className="admin-panel admin-full-panel"><p className="eyebrow">School management</p><h2>School records are not part of the current data model</h2><p>The active Edusphere schema has no schools table or school-to-user, class, or content relationships. This section is intentionally read-only rather than showing simulated school records. Adding school administration safely requires a coordinated schema and authorization update across the existing learning and AI APIs.</p></section>}
        {tab === 'teachers' && <TeacherSection teachers={teachers} create={async (input) => { await api.createAdminTeacher(input); await loadTab(tab) }} verify={async (id, status) => { await api.updateTeacherStatus(id, status); await loadTab(tab) }} resend={async (id) => { await api.resendTeacherVerification(id); await loadTab(tab) }} savePermissions={async (id, permissions) => { await api.setTeacherPermissions(id, permissions); await loadTab(tab) }} />}
        {tab === 'verification' && <TeacherSection teachers={teachers} create={async (input) => { await api.createAdminTeacher(input); await loadTab(tab) }} verify={async (id, status) => { await api.updateTeacherStatus(id, status); await loadTab(tab) }} resend={async (id) => { await api.resendTeacherVerification(id); await loadTab(tab) }} savePermissions={async (id, permissions) => { await api.setTeacherPermissions(id, permissions); await loadTab(tab) }} verification />}
        {tab === 'review' && <ReviewSection rows={reviewRows} />}
        {tab === 'students' && <UsersSection users={users} total={userTotal} filters={filters} setFilters={setFilters} userFilters={userFilters} setUserFilters={setUserFilters} busy={busy} updateStatus={updateUserStatus} />}
        {tab === 'ai' && <section className="admin-panel admin-full-panel"><p className="eyebrow">AI Tutor governance</p><h2>AI drafts remain reviewable</h2><p>Teacher and AI-generated material must be saved as draft content and published through this CMS before students can see it.</p></section>}
        {tab === 'settings' && <section className="admin-panel admin-full-panel"><p className="eyebrow">Platform settings</p><h2>Publishing policy</h2><p>Students receive only published content that matches their education level, class, and program profile.</p></section>}
        {tab === 'audit' && <AuditSection rows={auditLogs} />}
        </div>
    </>
}

function Overview({ data }: { data: RecordValue | null }) {
    const stats = [['Students', data?.students], ['Teachers', data?.teachers], ['Courses', data?.courses], ['Subjects', data?.subjects], ['Published courses', data?.published_courses], ['Published lessons', data?.published_lessons], ['Draft courses', data?.draft_courses], ['Pending teachers', data?.pending_teachers]]
    return <section className="admin-stats">{stats.map(([label, value]) => <article className="stat-card" key={String(label)}><div className="stat-icon blue"><LayoutDashboard size={18} /></div><div><span>{String(label)}</span><strong>{value === undefined ? '...' : String(value)}</strong><small>Database total</small></div></article>)}</section>
}

function ContentSection({ label, type, rows, totalRows, form, filters, setFilters, busy, taxonomy, teachers, options, setField, create, update, changeStatus, remove, composerOpen, setComposerOpen }: { label: string; type: string; rows: RecordValue[]; totalRows: number; form: RecordValue; filters: { search: string; level: string; grade: string; program: string; subject: string; offset: number }; setFilters: (filters: { search: string; level: string; grade: string; program: string; subject: string; offset: number }) => void; busy: boolean; taxonomy: Taxonomy; teachers: RecordValue[]; options: { courses: RecordValue[]; modules: RecordValue[]; lessons: RecordValue[] }; setField: (name: string, value: unknown) => void; create: (event: FormEvent | null, publish?: boolean) => Promise<void> | void; update: (id: string, input: RecordValue) => Promise<void>; changeStatus: (id: string, status: string) => Promise<void>; remove: (id: string) => Promise<void>; composerOpen: boolean; setComposerOpen: (value: boolean) => void }) {
    const [editingId, setEditingId] = useState('')
    const [editingTitle, setEditingTitle] = useState('')
    const [composerStep, setComposerStep] = useState(0)
    const gradeFilters = taxonomy.grades.filter((grade) => !filters.level || String(grade.education_level_id) === filters.level)
    const contextualTypes = ['subjects', 'courses', 'modules', 'lessons', 'notes', 'examples', 'exercises', 'assignments', 'quizzes', 'tests', 'exams']
    const targetNeeded = contextualTypes.includes(type)
    const targetGrades = taxonomy.grades.filter((grade) => !form.educationLevelId || String(grade.education_level_id) === String(form.educationLevelId))
    const targetPrograms = taxonomy.programs.filter((program) => !form.gradeId || !Array.isArray(program.grade_ids) || !program.grade_ids.length || program.grade_ids.includes(String(form.gradeId)))
    const targetSubjects = taxonomy.subjects.filter((subject) => String(subject.education_level_id) === String(form.educationLevelId) && String(subject.grade_id) === String(form.gradeId) && String(subject.program_id ?? 'none') === String(form.programId || 'none'))
    const matchesTarget = (item: RecordValue) => String(item.education_level_id) === String(form.educationLevelId) && String(item.grade_id) === String(form.gradeId) && String(item.program_id ?? 'none') === String(form.programId || 'none')
    const scopedOptions = {
        courses: options.courses.filter(matchesTarget),
        modules: options.modules.filter(matchesTarget),
        lessons: options.lessons.filter(matchesTarget),
    }
    const composerSteps = [
        'School & class',
        'Topic & lesson',
        'Review & save',
    ]
    const selectedLevel = taxonomy.levels.find((level) => String(level.id) === String(form.educationLevelId))
    const selectedGrade = taxonomy.grades.find((grade) => String(grade.id) === String(form.gradeId))
    const selectedProgram = taxonomy.programs.find((program) => String(program.id) === String(form.programId))
    const selectedSubject = taxonomy.subjects.find((subject) => String(subject.id) === String(form.subjectId))
    async function saveEdit(row: RecordValue) {
        const key = ['levels', 'grades', 'programs', 'subjects'].includes(type) ? 'name' : type === 'exercises' ? 'prompt' : 'title'
        await update(String(row.id), { [key]: editingTitle.trim() })
        setEditingId('')
    }
    function composerSummary() {
        const parts = [text(selectedLevel?.name), text(selectedGrade?.name), text(selectedProgram?.name || 'No program'), text(selectedSubject?.name), text(form.title || form.name || 'Untitled lesson')]
        return parts.filter(Boolean).join(' • ')
    }
    return <div className="admin-two-column">
        <section className="admin-panel admin-full-panel">
            <div className="section-heading compact"><div><p className="eyebrow">Curriculum source of truth</p><h2>{label}</h2></div><span className="status-pill published">{rows.length} records</span></div>
            <div className="admin-cms-filters">
                <label className="admin-search"><Search size={15} /><input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value, offset: 0 })} placeholder={`Search ${label.toLowerCase()}`} /></label>
                <select aria-label="Filter education level" value={filters.level} onChange={(event) => setFilters({ ...filters, level: event.target.value, grade: '', program: '', subject: '', offset: 0 })}><option value="">All education levels</option>{taxonomy.levels.map((item) => <option key={text(item.id)} value={text(item.id)}>{text(item.name)}</option>)}</select>
                <select aria-label="Filter class or grade" value={filters.grade} onChange={(event) => setFilters({ ...filters, grade: event.target.value, program: '', subject: '', offset: 0 })}><option value="">All classes</option>{gradeFilters.map((item) => <option key={text(item.id)} value={text(item.id)}>{text(item.name)}</option>)}</select>
                <select aria-label="Filter program" value={filters.program} onChange={(event) => setFilters({ ...filters, program: event.target.value, subject: '', offset: 0 })}><option value="">All programs</option><option value="none">No program</option>{taxonomy.programs.map((item) => <option key={text(item.id)} value={text(item.id)}>{text(item.name)}</option>)}</select>
                <select aria-label="Filter subject" value={filters.subject} onChange={(event) => setFilters({ ...filters, subject: event.target.value, offset: 0 })}><option value="">All subjects</option>{taxonomy.subjects.map((item) => <option key={text(item.id)} value={text(item.id)}>{text(item.name)}</option>)}</select>
            </div>
            <div className="admin-table admin-content-table">{rows.map((row) => <div className="admin-table-row" key={text(row.id)}>
                <div>{editingId === text(row.id) ? <input aria-label="Edit content name" value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} /> : <strong>{titleFor(row)}</strong>}<small>{text(row.course || row.module || row.lesson || row.subject || row.education_level_name)}</small></div>
                <span className={`status-pill ${row.status === 'published' ? 'published' : row.status === 'archived' ? 'rejected' : 'draft'}`}>{text(row.status || 'configured')}</span>
                <div className="admin-table-actions">{editingId === text(row.id) ? <><button onClick={() => void saveEdit(row)}>Save</button><button onClick={() => setEditingId('')}>Cancel</button></> : <button onClick={() => { setEditingId(text(row.id)); setEditingTitle(titleFor(row)) }}>Edit</button>}
                    {Boolean(row.status && row.status !== 'published' && row.status !== 'archived') && <button onClick={() => void changeStatus(text(row.id), 'published')}>Publish</button>}
                    {row.status === 'published' && <button onClick={() => void changeStatus(text(row.id), 'draft')}>Unpublish</button>}
                    {Boolean(row.status && row.status !== 'archived') && <button onClick={() => void changeStatus(text(row.id), 'archived')}><Archive size={14} /> Archive</button>}
                    {row.status === 'archived' && <button onClick={() => void changeStatus(text(row.id), 'draft')}>Restore</button>}
                    <button onClick={() => void remove(text(row.id))} aria-label={`Delete ${titleFor(row)}`}><Trash2 size={14} /></button>
                </div>
            </div>)}{!rows.length && <p className="admin-empty">No records match this search or filter.</p>}</div>
            <div className="admin-pagination"><span>{totalRows ? filters.offset + 1 : 0}–{filters.offset + rows.length} of {totalRows}</span><div><button className="secondary-button" disabled={filters.offset === 0} onClick={() => setFilters({ ...filters, offset: Math.max(0, filters.offset - 100) })}>Previous</button><button className="secondary-button" disabled={filters.offset + rows.length >= totalRows} onClick={() => setFilters({ ...filters, offset: filters.offset + 100 })}>Next</button></div></div>
        </section>
        <section className="admin-panel" id="admin-content-form">
            <div className="admin-composer-header">
                <div>
                    <p className="eyebrow">Content workflow</p>
                    <h2>{composerOpen ? 'Create content in a guided flow' : `Create ${label.toLowerCase()}`}</h2>
                </div>
                <button className="secondary-button" type="button" onClick={() => setComposerOpen(!composerOpen)}>{composerOpen ? 'Hide wizard' : 'Open wizard'}</button>
            </div>
            {composerOpen && <div className="admin-composer"><div className="admin-composer-steps">{composerSteps.map((step, index) => <button key={step} type="button" className={composerStep === index ? 'active' : ''} onClick={() => setComposerStep(index)}>{index + 1}. {step}</button>)}</div>
                <form className="admin-create-form" onSubmit={create}>
                    {composerStep === 0 && <div className="admin-wizard-panel">{targetNeeded && <TargetSelector type={type} form={form} taxonomy={taxonomy} setField={setField} grades={targetGrades} programs={targetPrograms} subjects={targetSubjects} />}</div>}
                    {composerStep === 1 && <div className="admin-wizard-panel">{fieldsFor(type, form, taxonomy, teachers, scopedOptions, setField)}</div>}
                    {composerStep === 2 && <div className="admin-wizard-panel admin-review-box"><h3>Content summary</h3><p>{composerSummary()}</p><div className="admin-review-grid"><span><strong>Level:</strong> {text(selectedLevel?.name || 'Not set')}</span><span><strong>Class:</strong> {text(selectedGrade?.name || 'Not set')}</span><span><strong>Program:</strong> {text(selectedProgram?.name || 'No program')}</span><span><strong>Subject:</strong> {text(selectedSubject?.name || 'Not set')}</span></div></div>}
                    <div className="admin-composer-actions">
                        <button className="secondary-button" type="button" disabled={composerStep === 0} onClick={() => setComposerStep((current) => Math.max(0, current - 1))}>Back</button>
                        {composerStep < composerSteps.length - 1 ? <button className="primary-button" type="button" onClick={() => setComposerStep((current) => Math.min(composerSteps.length - 1, current + 1))}>Next</button> : <><button className="secondary-button" type="button" disabled={busy} onClick={() => void create(null, false)}>Save as draft</button><button className="primary-button" disabled={busy} type="button" onClick={() => void create(null, true)}><Check size={15} /> Publish now</button></>}</div>
                </form>
            </div>}
            {!composerOpen && <form className="admin-create-form" onSubmit={(event) => void create(event, false)}>
                {targetNeeded && <TargetSelector type={type} form={form} taxonomy={taxonomy} setField={setField} grades={targetGrades} programs={targetPrograms} subjects={targetSubjects} />}
                {fieldsFor(type, form, taxonomy, teachers, scopedOptions, setField)}
                <div className="admin-composer-actions">
                    <button className="secondary-button" type="submit" disabled={busy}>Save as draft</button>
                    <button className="primary-button" type="button" disabled={busy} onClick={() => void create(null, true)}><Check size={15} /> Publish now</button>
                </div>
            </form>}
        </section>
    </div>
}

function TargetSelector({ type, form, taxonomy, setField, grades, programs, subjects }: { type: string; form: RecordValue; taxonomy: Taxonomy; setField: (name: string, value: unknown) => void; grades: RecordValue[]; programs: RecordValue[]; subjects: RecordValue[] }) {
    return <fieldset className="admin-target-selector"><legend>Target learning path</legend>
        <Field label="Education Level" name="educationLevelId" value={form.educationLevelId} setField={(name, value) => { setField(name, value); setField('gradeId', ''); setField('programId', 'none'); setField('subjectId', '') }} options={taxonomy.levels.map((item) => ({ value: text(item.id), label: text(item.name) }))} />
        <Field label="Class / Grade" name="gradeId" value={form.gradeId} setField={(name, value) => { setField(name, value); setField('programId', 'none'); setField('subjectId', '') }} options={grades.map((item) => ({ value: text(item.id), label: text(item.name) }))} />
        <Field label="Program" name="programId" value={form.programId} setField={(name, value) => { setField(name, value); setField('subjectId', '') }} options={[{ value: 'none', label: 'No program' }, ...programs.map((item) => ({ value: text(item.id), label: text(item.name) }))]} />
        {type !== 'subjects' && <Field label="Subject" name="subjectId" value={form.subjectId} setField={setField} options={subjects.map((item) => ({ value: text(item.id), label: text(item.name) }))} />}
    </fieldset>
}

function Field({ label, name, value, setField, options, required = true }: { label: string; name: string; value: unknown; setField: (name: string, value: unknown) => void; options?: Array<{ value: string; label: string }>; required?: boolean }) { return <label className="admin-field">{label}{options ? <select required={required} value={text(value)} onChange={(event) => setField(name, event.target.value)}><option value="">Choose {label.toLowerCase()}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input required={required} value={text(value)} onChange={(event) => setField(name, event.target.value)} />}</label> }
function fieldsFor(type: string, form: RecordValue, taxonomy: Taxonomy, teachers: RecordValue[], options: { courses: RecordValue[]; modules: RecordValue[]; lessons: RecordValue[] }, setField: (name: string, value: unknown) => void) {
    const levelOptions = taxonomy.levels.map((item) => ({ value: text(item.id), label: text(item.name) }))
    const teacherOptions = teachers.map((item) => ({ value: text(item.id), label: text(item.full_name) }))
    const courseOptions = options.courses.map((item) => ({ value: text(item.id), label: text(item.title) }))
    const moduleOptions = options.modules.map((item) => ({ value: text(item.id), label: `${text(item.title)} · ${text(item.course)}` }))
    const lessonOptions = options.lessons.map((item) => ({ value: text(item.id), label: `${text(item.title)} · ${text(item.module)}` }))
    if (type === 'levels') return <><Field label="Name" name="name" value={form.name} setField={setField} /><Field label="Code" name="code" value={form.code} setField={setField} /><Field label="Position" name="position" value={form.position || 0} setField={setField} /></>
    if (type === 'grades') return <><Field label="Education level" name="educationLevelId" value={form.educationLevelId} setField={setField} options={levelOptions} /><Field label="Name" name="name" value={form.name} setField={setField} /><Field label="Code" name="code" value={form.code} setField={setField} /></>
    if (type === 'programs') return <><Field label="Name" name="name" value={form.name} setField={setField} /><Field label="Description" name="description" value={form.description} setField={setField} /></>
    if (type === 'subjects') return <><Field label="Subject name" name="name" value={form.name} setField={setField} /><Field label="Description" name="description" value={form.description} setField={setField} /></>
    if (type === 'courses') return <><Field label="Course title" name="title" value={form.title} setField={setField} /><Field label="Assigned teacher (optional)" name="teacherId" value={form.teacherId} setField={setField} options={[{ value: '', label: 'Unassigned' }, ...teacherOptions]} required={false} /><Field label="Description" name="description" value={form.description} setField={setField} /><Field label="Difficulty" name="difficulty" value={form.difficulty || 'Beginner'} setField={setField} /></>
    if (type === 'modules') return <><Field label="Course" name="courseId" value={form.courseId} setField={setField} options={courseOptions} /><Field label="Title" name="title" value={form.title} setField={setField} /><Field label="Position" name="position" value={form.position || 0} setField={setField} /></>
    if (type === 'lessons') return <><Field label="Module" name="moduleId" value={form.moduleId} setField={setField} options={moduleOptions} /><Field label="Title" name="title" value={form.title} setField={setField} /><Field label="Duration minutes" name="durationMinutes" value={form.durationMinutes || 1} setField={setField} /><Field label="Position" name="position" value={form.position || 0} setField={setField} /></>
    if (type === 'notes' || type === 'examples') return <><Field label="Lesson" name="lessonId" value={form.lessonId} setField={setField} options={lessonOptions} /><Field label="Title" name="title" value={form.title} setField={setField} /><Field label="Body" name="body" value={form.body} setField={setField} /></>
    if (type === 'exercises') return <><Field label="Lesson" name="lessonId" value={form.lessonId} setField={setField} options={lessonOptions} /><Field label="Prompt" name="prompt" value={form.prompt} setField={setField} /><Field label="Answer" name="answer" value={form.answer} setField={setField} /></>
    if (type === 'assignments') return <><Field label="Course" name="courseId" value={form.courseId} setField={setField} options={courseOptions} /><Field label="Title" name="title" value={form.title} setField={setField} /><Field label="Instructions" name="instructions" value={form.instructions} setField={setField} /><Field label="Due date" name="dueAt" value={form.dueAt} setField={setField} /><Field label="Total marks" name="totalMarks" value={form.totalMarks || 100} setField={setField} /></>
    return <><Field label="Course ID" name="courseId" value={form.courseId} setField={setField} /><Field label="Title" name="title" value={form.title} setField={setField} /><Field label="Time limit seconds" name="timeLimitSeconds" value={form.timeLimitSeconds || 60} setField={setField} /></>
}

function TeacherSection({ teachers, create, verify, resend, savePermissions, verification = false }: { teachers: RecordValue[]; create: (input: { email: string; fullName: string; bio?: string }) => Promise<void>; verify: (id: string, status: string) => Promise<void>; resend: (id: string) => Promise<void>; savePermissions: (id: string, permissions: string[]) => Promise<void>; verification?: boolean }) { return <section className="admin-panel admin-full-panel"><div className="section-heading compact"><div><p className="eyebrow">{verification ? 'Governance' : 'Teacher accounts'}</p><h2>{verification ? 'Teacher verification queue' : 'Teachers and permissions'}</h2></div></div><TeacherCreate onCreate={create} />{teachers.map((teacher) => <TeacherRow key={text(teacher.id)} teacher={teacher} verify={verify} resend={resend} savePermissions={savePermissions} />)}{!teachers.length && <p className="admin-empty">No teachers found.</p>}</section> }
function TeacherCreate({ onCreate }: { onCreate: (input: { email: string; fullName: string; bio?: string }) => Promise<void> }) { const [email, setEmail] = useState(''); const [fullName, setFullName] = useState(''); const [bio, setBio] = useState(''); const [busy, setBusy] = useState(false); async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); try { await onCreate({ email, fullName, bio }); setEmail(''); setFullName(''); setBio('') } finally { setBusy(false) } } return <form className="admin-create-form" onSubmit={(event) => void submit(event)}><Field label="Teacher name" name="fullName" value={fullName} setField={(_, value) => setFullName(value as string)} /><Field label="Teacher email" name="email" value={email} setField={(_, value) => setEmail(value as string)} /><Field label="Profile / bio" name="bio" value={bio} setField={(_, value) => setBio(value as string)} /><button className="primary-button" disabled={busy} type="submit"><Plus size={15} /> Add teacher</button></form> }
function TeacherRow({ teacher, verify, resend, savePermissions }: { teacher: RecordValue; verify: (id: string, status: string) => Promise<void>; resend: (id: string) => Promise<void>; savePermissions: (id: string, permissions: string[]) => Promise<void> }) { const existing = Array.isArray(teacher.permissions) ? teacher.permissions.filter((permission): permission is string => typeof permission === 'string') : []; const [permissions, setPermissions] = useState(existing); const options = ['content.create', 'content.edit', 'content.publish', 'assessment.manage']; const status = text(teacher.teacher_verification_status); function toggle(permission: string) { const next = permissions.includes(permission) ? permissions.filter((item) => item !== permission) : [...permissions, permission]; setPermissions(next); void savePermissions(text(teacher.id), next) } return <div className="admin-table-row"><div><strong>{text(teacher.full_name)}</strong><small>{text(teacher.email)} · {text(teacher.subjects) || 'No subjects'} · {text(teacher.courses)} courses</small><small>Created {text(teacher.created_at)} · Last login {text(teacher.last_login_at) || 'Never'}</small><div className="admin-permission-list">{options.map((permission) => <label key={permission}><input type="checkbox" checked={permissions.includes(permission)} onChange={() => toggle(permission)} />{permission}</label>)}</div></div><span className={`status-pill ${status === 'verified' || status === 'approved' ? 'published' : 'draft'}`}>{status || 'pending'}</span><div className="admin-table-actions"><button onClick={() => void verify(text(teacher.id), 'approved')}><Check size={14} /> Approve</button><button onClick={() => void verify(text(teacher.id), 'rejected')}>Reject</button><button onClick={() => void verify(text(teacher.id), status === 'suspended' ? 'approved' : 'suspended')}>{status === 'suspended' ? 'Reactivate' : 'Suspend'}</button><button onClick={() => void resend(text(teacher.id))}><MailIcon /> Resend</button></div></div> }
function MailIcon() { return <span aria-hidden="true">@</span> }
function UsersSection({ users, total, filters, setFilters, userFilters, setUserFilters, busy, updateStatus }: { users: RecordValue[]; total: number; filters: { search: string; offset: number }; setFilters: (filters: { search: string; level: string; grade: string; program: string; subject: string; offset: number }) => void; userFilters: { role: string; status: string }; setUserFilters: (filters: { role: string; status: string }) => void; busy: boolean; updateStatus: (user: RecordValue) => Promise<void> }) {
    const pageSize = 100
    return <section className="admin-panel admin-full-panel"><div className="section-heading compact"><div><p className="eyebrow">Account administration</p><h2>Registered users</h2></div><span className="muted-count">{total} total</span></div>
        <div className="admin-cms-filters"><label className="admin-search"><Search size={15} /><input value={filters.search} onChange={(event) => setFilters({ search: event.target.value, level: '', grade: '', program: '', subject: '', offset: 0 })} placeholder="Search by name or email" /></label>
            <select aria-label="Filter users by role" value={userFilters.role} onChange={(event) => { setUserFilters({ ...userFilters, role: event.target.value }); setFilters({ search: filters.search, level: '', grade: '', program: '', subject: '', offset: 0 }) }}><option value="">All roles</option><option value="student">Students</option><option value="teacher">Teachers</option><option value="admin">Admins</option><option value="super-admin">Super admins</option></select>
            <select aria-label="Filter users by status" value={userFilters.status} onChange={(event) => { setUserFilters({ ...userFilters, status: event.target.value }); setFilters({ search: filters.search, level: '', grade: '', program: '', subject: '', offset: 0 }) }}><option value="">All statuses</option><option value="active">Active</option><option value="pending">Pending</option><option value="suspended">Suspended</option></select>
        </div>
        <div className="admin-table">{users.map((user) => <div className="admin-table-row" key={text(user.id)}><div><strong>{text(user.full_name)}</strong><small>{text(user.email)} · {text(user.role)}</small><small>Created {text(user.created_at)} · Last login {text(user.last_login_at) || 'Never'}</small></div>
            <span className={`status-pill ${user.status === 'active' ? 'published' : user.status === 'suspended' ? 'rejected' : 'draft'}`}>{text(user.status)}</span>
            <div className="admin-table-actions">{!['admin', 'super-admin'].includes(text(user.role)) && <button disabled={busy} onClick={() => void updateStatus(user)}>{user.status === 'active' ? 'Suspend' : 'Activate'}</button>}</div>
        </div>)}{!users.length && <p className="admin-empty">No registered users match these filters.</p>}</div>
        <div className="admin-pagination"><span>{total ? filters.offset + 1 : 0}–{filters.offset + users.length} of {total}</span><div><button className="secondary-button" disabled={filters.offset === 0 || busy} onClick={() => setFilters({ search: filters.search, level: '', grade: '', program: '', subject: '', offset: Math.max(0, filters.offset - pageSize) })}>Previous</button><button className="secondary-button" disabled={filters.offset + users.length >= total || busy} onClick={() => setFilters({ search: filters.search, level: '', grade: '', program: '', subject: '', offset: filters.offset + pageSize })}>Next</button></div></div>
    </section>
}
function AuditSection({ rows }: { rows: RecordValue[] }) { return <section className="admin-panel admin-full-panel"><p className="eyebrow">Immutable history</p><h2>Audit logs</h2>{rows.map((row) => <div className="audit-row" key={text(row.id)}><strong>{text(row.action)}</strong><span>{text(row.entity_type)} · {text(row.entity_id)}</span><small>{text(row.created_at)}</small></div>)}{!rows.length && <p className="admin-empty">No admin actions recorded yet.</p>}</section> }
function ReviewSection({ rows }: { rows: RecordValue[] }) { return <section className="admin-panel admin-full-panel"><div className="section-heading compact"><div><p className="eyebrow">Teacher submissions</p><h2>Content review</h2></div><span className="status-pill draft">{rows.length} awaiting action</span></div>{rows.map((row) => <div className="admin-table-row" key={`${text(row.content_type)}-${text(row.id)}`}><div><strong>{text(row.title)}</strong><small>{text(row.teacher)} · {text(row.subject)} · {text(row.class_name) || 'Unassigned class'} · {text(row.program) || 'No program'}</small></div><span className="status-pill draft">{text(row.content_type)} · {text(row.status)}</span><div className="admin-table-actions"><button onClick={() => void api.setAdminContentStatus(text(row.content_type) === 'course' ? 'courses' : text(row.content_type) === 'lesson' ? 'lessons' : 'assignments', text(row.id), 'published')}>Publish</button><button onClick={() => void api.setAdminContentStatus(text(row.content_type) === 'course' ? 'courses' : text(row.content_type) === 'lesson' ? 'lessons' : 'assignments', text(row.id), 'rejected')}>Request changes</button><button onClick={() => void api.setAdminContentStatus(text(row.content_type) === 'course' ? 'courses' : text(row.content_type) === 'lesson' ? 'lessons' : 'assignments', text(row.id), 'archived')}><Archive size={14} /> Archive</button></div></div>)}{!rows.length && <p className="admin-empty">No teacher content is waiting for review.</p>}</section> }
