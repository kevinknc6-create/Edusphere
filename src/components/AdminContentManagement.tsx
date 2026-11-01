import { useEffect, useState } from 'react'
import { FileText, Plus, Search, Trash2, X } from 'lucide-react'
import { api } from '../lib/api'

type RecordValue = Record<string, unknown>
type Filters = { search: string; level: string; grade: string; program: string; subject: string; offset: number }
type Taxonomy = { levels: RecordValue[]; grades: RecordValue[]; programs: RecordValue[]; subjects: RecordValue[] }

function text(value: unknown) { return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value) }

function Field({ label, name, value, setField, options, required = true }: { label: string; name: string; value: unknown; setField: (name: string, value: unknown) => void; options?: Array<{ value: string; label: string }>; required?: boolean }) {
    return <label className="admin-field">{label}{options ? <select required={required} value={text(value)} onChange={(event) => setField(name, event.target.value)}><option value="">Choose {label.toLowerCase()}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input required={required} value={text(value)} onChange={(event) => setField(name, event.target.value)} />}</label>
}

export function SchoolsSection({ rows, filters, setFilters, busy, create, updateStatus }: { rows: RecordValue[]; filters: Filters; setFilters: (filters: Filters) => void; busy: boolean; create: (input: { name: string; email: string; location: string; phone: string }) => Promise<void>; updateStatus: (school: RecordValue) => Promise<void> }) {
    const [school, setSchool] = useState({ name: '', email: '', location: '', phone: '' })
    return <div className="admin-two-column">
        <section className="admin-panel admin-full-panel">
            <div className="section-heading compact"><div><p className="eyebrow">Existing school records</p><h2>Schools for learning content</h2></div><span className="status-pill published">{rows.length} records</span></div>
            <label className="admin-search"><Search size={15} /><input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value, offset: 0 })} placeholder="Search schools" /></label>
            <div className="admin-table">{rows.map((row) => <div className="admin-table-row" key={text(row.id)}><div><strong>{text(row.name)}</strong><small>{text(row.email)}{row.location ? ` · ${text(row.location)}` : ''}</small></div><span className={`status-pill ${row.status === 'active' ? 'published' : 'draft'}`}>{text(row.status)}</span><button className="secondary-button" disabled={busy} onClick={() => void updateStatus(row)}>{row.status === 'active' ? 'Deactivate' : 'Activate'}</button></div>)}{!rows.length && <p className="admin-empty">No schools found. Add an active school to use it for student profiles and subject notes.</p>}</div>
            <div className="admin-pagination"><span>{filters.offset + 1}–{filters.offset + rows.length}</span><div><button className="secondary-button" disabled={filters.offset === 0} onClick={() => setFilters({ ...filters, offset: Math.max(0, filters.offset - 100) })}>Previous</button><button className="secondary-button" disabled={rows.length < 100} onClick={() => setFilters({ ...filters, offset: filters.offset + 100 })}>Next</button></div></div>
        </section>
        <section className="admin-panel">
            <p className="eyebrow">School directory</p><h2>Add a school</h2>
            <form className="admin-create-form" onSubmit={(event) => { event.preventDefault(); void create(school).then(() => setSchool({ name: '', email: '', location: '', phone: '' })).catch(() => undefined) }}>
                <Field label="School name" name="name" value={school.name} setField={(_name, value) => setSchool({ ...school, name: String(value) })} />
                <Field label="School email" name="email" value={school.email} setField={(_name, value) => setSchool({ ...school, email: String(value) })} />
                <Field label="Location" name="location" value={school.location} setField={(_name, value) => setSchool({ ...school, location: String(value) })} required={false} />
                <Field label="Phone" name="phone" value={school.phone} setField={(_name, value) => setSchool({ ...school, phone: String(value) })} required={false} />
                <button className="primary-button" type="submit" disabled={busy}><Plus size={15} /> Add school</button>
            </form>
        </section>
    </div>
}

export function SubjectNotesSection({ rows, totalRows, schools, taxonomy, referencesLoading, curriculumAvailable, filters, setFilters, busy, save, changeStatus, remove }: { rows: RecordValue[]; totalRows: number; schools: RecordValue[]; taxonomy: Taxonomy; referencesLoading: boolean; curriculumAvailable: boolean; filters: Filters; setFilters: (filters: Filters) => void; busy: boolean; save: (id: string | null, input: RecordValue) => Promise<void>; changeStatus: (id: string, status: string) => Promise<void>; remove: (id: string) => Promise<void> }) {
    const blankForm = { schoolId: '', educationLevelId: '', gradeId: '', programId: 'none', subjectId: '', title: '', topic: '', body: '', attachmentIds: [] as string[] }
    const [form, setForm] = useState(blankForm)
    const [editingId, setEditingId] = useState('')
    const [uploading, setUploading] = useState(false)
    const [attachmentError, setAttachmentError] = useState('')
    useEffect(() => {
        if (form.gradeId && form.educationLevelId) {
            const selectedGrade = taxonomy.grades.find((grade) => text(grade.id) === form.gradeId)
            if (selectedGrade && text(selectedGrade.education_level_id) !== form.educationLevelId) {
                setForm((current) => ({ ...current, gradeId: '', programId: 'none', subjectId: '' }))
            }
        }
    }, [form.educationLevelId, form.gradeId, taxonomy.grades])
    const attachments = (form.attachmentIds.map((id) => {
        const row = rows.flatMap((note) => Array.isArray(note.attachments) ? note.attachments as RecordValue[] : []).find((item) => text(item.id) === id)
        return row ? { id, name: text(row.name), size: Number(row.size) } : null
    }).filter(Boolean)) as Array<{ id: string; name: string; size: number }>
    const [uploadedFiles, setUploadedFiles] = useState<Array<{ id: string; name: string; size: number }>>([])
    const activeSchools = schools.filter((school) => school.status === 'active')
    const grades = taxonomy.grades.filter((grade) => !form.educationLevelId || text(grade.education_level_id) === form.educationLevelId)
    const programs = taxonomy.programs.filter((program) => !form.gradeId || !Array.isArray(program.grade_ids) || !program.grade_ids.length || program.grade_ids.includes(form.gradeId))
    const subjects = taxonomy.subjects.filter((subject) =>
        (!subject.education_level_id || text(subject.education_level_id) === form.educationLevelId)
        && (!subject.grade_id || text(subject.grade_id) === form.gradeId)
        && (!subject.program_id || text(subject.program_id) === form.programId))

    async function clearUploadedFiles() {
        const pending = [...uploadedFiles]
        setUploadedFiles([])
        const results = await Promise.allSettled(pending.map((file) => api.deleteStagedSubjectNoteFile(file.id)))
        if (results.some((result) => result.status === 'rejected')) setAttachmentError('Some temporary uploaded files could not be removed.')
    }

    function edit(row: RecordValue) {
        void clearUploadedFiles()
        setEditingId(text(row.id))
        setForm({
            schoolId: text(row.school_id),
            educationLevelId: text(row.education_level_id),
            gradeId: text(row.grade_id),
            programId: text(row.program_id || 'none'),
            subjectId: text(row.subject_id),
            title: text(row.title),
            topic: text(row.topic),
            body: text(row.body),
            attachmentIds: Array.isArray(row.attachments) ? (row.attachments as RecordValue[]).map((item) => text(item.id)) : [],
        })
        setUploadedFiles([])
        setAttachmentError('')
        document.getElementById('admin-subject-note-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    async function saveNote(status: 'draft' | 'published') {
        if (!form.body.trim() && !form.attachmentIds.length) {
            setAttachmentError('Add note content or at least one file before saving.')
            return
        }
        setAttachmentError('')
        try {
            const input = { ...form, programId: form.programId === 'none' ? null : form.programId, ...(editingId ? {} : { status }) }
            await save(editingId || null, input)
            setForm(blankForm)
            setEditingId('')
            setUploadedFiles([])
        } catch { /* The parent displays API errors. */ }
    }

    async function addFiles(files: FileList | null) {
        if (!files?.length) return
        if (form.attachmentIds.length + files.length > 10) {
            setAttachmentError('A note can have no more than 10 files.')
            return
        }
        setUploading(true)
        setAttachmentError('')
        try {
            for (const file of Array.from(files)) {
                const uploaded = await api.uploadSubjectNoteFile(file)
                setForm((current) => ({ ...current, attachmentIds: [...current.attachmentIds, uploaded.id] }))
                setUploadedFiles((current) => [...current, uploaded])
            }
        } catch (caught) {
            setAttachmentError(caught instanceof Error ? caught.message : 'File upload failed.')
        } finally { setUploading(false) }
    }

    function removeFile(id: string) {
        setForm((current) => ({ ...current, attachmentIds: current.attachmentIds.filter((attachmentId) => attachmentId !== id) }))
        const staged = uploadedFiles.find((file) => file.id === id)
        if (staged) {
            setUploadedFiles((current) => current.filter((file) => file.id !== id))
            void api.deleteStagedSubjectNoteFile(id).catch((caught) => setAttachmentError(caught instanceof Error ? caught.message : 'The temporary upload could not be removed.'))
        }
    }

    return <div className="admin-two-column">
        <section className="admin-panel admin-full-panel">
            <div className="section-heading compact"><div><p className="eyebrow">Persistent curriculum notes</p><h2>Published and draft subject notes</h2></div><span className="status-pill published">{totalRows} records</span></div>
            <label className="admin-search"><Search size={15} /><input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value, offset: 0 })} placeholder="Search title, topic, content, school, class, or subject" /></label>
            <div className="admin-table admin-content-table">{rows.map((row) => <div className="admin-table-row" key={text(row.id)}>
                <div><strong>{text(row.title)}</strong><small>{text(row.topic) || 'No topic'} · {text(row.school_name)} · {text(row.class_name)} · {text(row.subject_name)}</small></div>
                <span className={`status-pill ${row.status === 'published' ? 'published' : row.status === 'archived' ? 'rejected' : 'draft'}`}>{text(row.status)}</span>
                <div className="admin-table-actions">
                    <button onClick={() => edit(row)}>Edit</button>
                    {row.status === 'published' ? <button disabled={busy} onClick={() => void changeStatus(text(row.id), 'draft')}>Unpublish</button> : <button disabled={busy} onClick={() => void changeStatus(text(row.id), 'published')}>Publish</button>}
                    <button disabled={busy} onClick={() => void remove(text(row.id))} aria-label={`Delete ${text(row.title)}`}><Trash2 size={14} /></button>
                </div>
            </div>)}{!rows.length && <p className="admin-empty">No subject notes match this search.</p>}</div>
            <div className="admin-pagination"><span>{totalRows ? filters.offset + 1 : 0}–{filters.offset + rows.length} of {totalRows}</span><div><button className="secondary-button" disabled={filters.offset === 0} onClick={() => setFilters({ ...filters, offset: Math.max(0, filters.offset - 100) })}>Previous</button><button className="secondary-button" disabled={filters.offset + rows.length >= totalRows} onClick={() => setFilters({ ...filters, offset: filters.offset + 100 })}>Next</button></div></div>
        </section>
        <section className="admin-panel" id="admin-subject-note-form">
            <p className="eyebrow">Subject-by-subject notes</p><h2>{editingId ? 'Edit subject note' : 'Add subject note'}</h2>
            <form className="admin-create-form" onSubmit={(event) => { event.preventDefault(); void saveNote('draft') }}>
                <fieldset className="admin-target-selector"><legend>Target school and curriculum</legend>
                    <Field label="School" name="schoolId" value={form.schoolId} setField={(name, value) => setForm((current) => ({ ...current, [name]: value }))} options={activeSchools.map((school) => ({ value: text(school.id), label: text(school.name) }))} />
                    <Field label="Education level" name="educationLevelId" value={form.educationLevelId} setField={(_name, value) => setForm((current) => ({ ...current, educationLevelId: String(value), gradeId: '', programId: 'none', subjectId: '' }))} options={taxonomy.levels.map((level) => ({ value: text(level.id), label: text(level.name) }))} />
                    <Field label="Class / grade" name="gradeId" value={form.gradeId} setField={(_name, value) => {
                        const selected = taxonomy.grades.find((grade) => text(grade.id) === String(value))
                        setForm((current) => ({ ...current, gradeId: String(value), educationLevelId: current.educationLevelId || text(selected?.education_level_id), programId: 'none', subjectId: '' }))
                    }} options={grades.map((grade) => ({ value: text(grade.id), label: `${text(grade.name)}${!form.educationLevelId && grade.education_level_name ? ` · ${text(grade.education_level_name)}` : ''}` }))} />
                    <Field label="Program" name="programId" value={form.programId} setField={(name, value) => setForm((current) => ({ ...current, [name]: value, subjectId: '' }))} options={[{ value: 'none', label: 'No program' }, ...programs.map((program) => ({ value: text(program.id), label: text(program.name) }))]} />
                    <Field label="Subject" name="subjectId" value={form.subjectId} setField={(name, value) => setForm((current) => ({ ...current, [name]: value }))} options={subjects.map((subject) => ({ value: text(subject.id), label: text(subject.name) }))} />
                </fieldset>
                <Field label="Note title" name="title" value={form.title} setField={(name, value) => setForm((current) => ({ ...current, [name]: value }))} />
                <Field label="Topic or chapter" name="topic" value={form.topic} setField={(name, value) => setForm((current) => ({ ...current, [name]: value }))} required={false} />
                <label className="admin-field">Note content (optional when a file is attached)<textarea maxLength={40000} rows={8} value={form.body} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} /></label>
                <div className="admin-field"><span>Attach files (PDF, Word, PowerPoint, or image · max 15 MB each)</span><input type="file" multiple accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/jpeg,image/png,image/webp" disabled={busy || uploading} onChange={(event) => { void addFiles(event.target.files); event.currentTarget.value = '' }} />{attachmentError && <span className="auth-error" role="alert">{attachmentError}</span>}{uploading && <span role="status">Uploading attachment...</span>}
                    {(attachments.length > 0 || uploadedFiles.length > 0) && <ul className="subject-note-file-list">{[...attachments, ...uploadedFiles.filter((file) => !attachments.some((item) => item.id === file.id))].map((file) => <li key={file.id}><FileText size={15} /><span>{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => removeFile(file.id)}><X size={14} /></button></li>)}</ul>}
                </div>
                <div className="admin-composer-actions">
                    {editingId ? <><button className="secondary-button" type="submit" disabled={busy || uploading}>Save changes</button><button className="secondary-button" type="button" onClick={() => { void clearUploadedFiles(); setEditingId(''); setForm(blankForm) }}>Cancel edit</button></> : <><button className="secondary-button" type="submit" disabled={busy || uploading}>Save as draft</button><button className="primary-button" type="button" disabled={busy || uploading} onClick={(event) => { if (event.currentTarget.form?.reportValidity()) void saveNote('published') }}>Publish note</button></>}
                </div>
                {referencesLoading && <p className="admin-empty" role="status">Loading curriculum classes…</p>}
                {!referencesLoading && !curriculumAvailable && <p className="admin-empty" role="alert">Curriculum classes could not be loaded. Refresh the page and try again.</p>}
                {!referencesLoading && curriculumAvailable && !taxonomy.grades.length && <p className="admin-empty" role="alert">No classes are available. Add classes under Classes in the Admin dashboard, then refresh.</p>}
                {!activeSchools.length && <p className="admin-empty">Create or activate a school in the Schools section before adding notes.</p>}
            </form>
        </section>
    </div>
}
