import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ExternalLink, FileText, LoaderCircle, Pencil, RefreshCw, RotateCcw, Search, Trash2, Upload } from 'lucide-react'
import { api } from '../lib/api'

type Row = Record<string, unknown>
type Taxonomy = { levels: Row[]; grades: Row[]; programs: Row[]; subjects: Row[] }
type Registry = { subjects: Row[]; programs: Row[]; tvetSubjects: Row[] }
type FormFields = Record<string, string>

const emptyForm: FormFields = {
    schoolId: '', curriculumVersionId: '', educationLevelId: '', gradeId: '', programId: '',
    subjectId: '', tvetSubjectId: '', materialType: 'textbook', title: '',
    description: '', publisher: '', edition: '', sourceReference: '', url: '', rightsConfirmed: 'false',
}
const materialTypes = ['textbook', 'notes', 'module', 'learning_guide', 'teacher_guide', 'worksheet', 'digital', 'other']

function value(row: Row, key: string) {
    const item = row[key]
    return typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' ? String(item) : ''
}

function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback
}

export default function LearningMaterialsManagement() {
    const [rows, setRows] = useState<Row[]>([])
    const [taxonomy, setTaxonomy] = useState<Taxonomy>({ levels: [], grades: [], programs: [], subjects: [] })
    const [registry, setRegistry] = useState<Registry>({ subjects: [], programs: [], tvetSubjects: [] })
    const [schools, setSchools] = useState<Row[]>([])
    const [form, setForm] = useState<FormFields>(emptyForm)
    const [sourceType, setSourceType] = useState<'upload' | 'url'>('upload')
    const [file, setFile] = useState<File | null>(null)
    const [editingId, setEditingId] = useState('')
    const [search, setSearch] = useState('')
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')

    const loadMaterials = useCallback(async (query: string) => {
        const result = await api.adminLearningMaterials(query)
        setRows(result.data)
    }, [])

    const load = useCallback(async () => {
        setLoading(true)
        setError('')
        try {
            const [materialRows, taxonomyResult, registryResult, schoolResult] = await Promise.all([
                api.adminLearningMaterials(search),
                api.adminTaxonomy(),
                api.adminCurriculumRegistry(),
                api.adminSchools({ limit: 500 }),
            ])
            setRows(materialRows.data)
            setTaxonomy(taxonomyResult.data)
            setRegistry(registryResult.data)
            setSchools(schoolResult.data)
        } catch (caught) {
            setError(errorMessage(caught, 'Learning materials could not be loaded.'))
        } finally {
            setLoading(false)
        }
    }, [search])

    useEffect(() => { void load() }, [load])
    useEffect(() => {
        if (!rows.some((row) => ['pending', 'processing'].includes(value(row, 'processing_status')))) return
        const timer = window.setInterval(() => {
            void loadMaterials(search).catch((caught) => setError(errorMessage(caught, 'Processing status could not be refreshed.')))
        }, 3000)
        return () => window.clearInterval(timer)
    }, [rows, search, loadMaterials])

    const selectedGrade = taxonomy.grades.find((grade) => value(grade, 'id') === form.gradeId)
    const selectedLevelId = form.educationLevelId || value(selectedGrade || {}, 'education_level_id')
    const selectedLevel = taxonomy.levels.find((level) => value(level, 'id') === selectedLevelId)
    const tvetGrade = /^l[345]$/i.test(value(selectedGrade || {}, 'code'))
        || /tvet/i.test(value(selectedLevel || {}, 'category'))
        || /tvet/i.test(value(selectedLevel || {}, 'name'))
    const grades = taxonomy.grades.filter((grade) => !form.educationLevelId || value(grade, 'education_level_id') === form.educationLevelId)
    const tvetGradeIds = taxonomy.grades.filter((grade) => {
        const level = taxonomy.levels.find((item) => value(item, 'id') === value(grade, 'education_level_id'))
        return /^l[345]$/i.test(value(grade, 'code'))
            || /tvet/i.test(value(level || {}, 'category'))
            || /tvet/i.test(value(level || {}, 'name'))
    }).map((grade) => value(grade, 'id'))
    const programs = taxonomy.programs.filter((program) => {
        if (!tvetGrade) return true
        const gradeIds = program.grade_ids
        if (!Array.isArray(gradeIds)) return false
        const linkedGrades = gradeIds.map(String)
        return form.gradeId
            ? linkedGrades.includes(form.gradeId)
            : linkedGrades.some((gradeId) => tvetGradeIds.includes(gradeId))
    })
    const curriculumSubjects = registry.subjects.filter((subject) =>
        value(subject, 'verification_status') === 'verified'
        && value(subject, 'version_status') === 'active'
        && (!selectedLevelId || value(subject, 'education_level_id') === selectedLevelId)
        && (!form.gradeId || !value(subject, 'grade_id') || value(subject, 'grade_id') === form.gradeId)
        && (!form.programId || !value(subject, 'program_id') || value(subject, 'program_id') === form.programId))
    const tvetSubjects = registry.tvetSubjects.filter((subject) =>
        value(subject, 'status') === 'published'
        && value(subject, 'version_status') === 'active'
        && value(subject, 'verification_status') === 'verified'
        && (!form.programId || value(subject, 'program_id') === form.programId)
        && (!form.gradeId || value(subject, 'grade_id') === form.gradeId))
    function setField(name: string, fieldValue: string) {
        setForm((current) => ({ ...current, [name]: fieldValue }))
    }

    function resetForm() {
        setForm(emptyForm)
        setSourceType('upload')
        setFile(null)
        setEditingId('')
    }

    function edit(row: Row) {
        setEditingId(value(row, 'id'))
        setSourceType(value(row, 'source_type') === 'url' ? 'url' : 'upload')
        setFile(null)
        setForm({
            schoolId: value(row, 'school_id'), curriculumVersionId: value(row, 'curriculum_version_id'),
            educationLevelId: value(row, 'education_level_id'), gradeId: value(row, 'grade_id'),
            programId: value(row, 'program_id'), subjectId: value(row, 'subject_id'),
            tvetSubjectId: value(row, 'tvet_subject_id'), materialType: value(row, 'material_type'),
            title: value(row, 'title'), description: value(row, 'description'),
            edition: value(row, 'edition'), publisher: value(row, 'publisher'),
            sourceReference: value(row, 'source_reference'), url: value(row, 'url'),
            rightsConfirmed: value(row, 'rights_confirmed') === 'true' ? 'true' : 'false',
        })
        document.getElementById('learning-material-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    async function submit(event: FormEvent) {
        event.preventDefault()
        setBusy(true)
        setError('')
        setSuccess('')
        try {
            const selectedSubject = subjectOptions.find((subject) =>
                value(subject, 'id') === (tvetGrade ? form.tvetSubjectId : form.subjectId))
            const input = {
                ...form,
                curriculumVersionId: selectedSubject ? value(selectedSubject, 'curriculum_version_id') : null,
                gradeId: form.gradeId || null,
                programId: form.programId || null,
                subjectId: tvetGrade && form.tvetSubjectId ? null : form.subjectId || null,
                tvetSubjectId: tvetGrade ? form.tvetSubjectId || null : null,
                curriculumUnitId: null,
                tvetUnitId: null,
                courseLessonId: null,
                tvetLessonId: null,
                rightsConfirmed: form.rightsConfirmed === 'true',
            }
            if (editingId) {
                if (sourceType === 'upload' && file) {
                    await api.replaceAdminLearningMaterialFile(editingId, input, file)
                    setSuccess('PDF replaced. The updated content is being processed and will need to be published again.')
                } else {
                    await api.updateAdminLearningMaterial(editingId, input)
                    setSuccess('Learning material assignments and metadata updated.')
                }
            } else if (sourceType === 'url') {
                await api.createAdminLearningMaterial(input)
                setSuccess('Link validated and saved. It will appear for assigned students automatically when processing is complete.')
            } else {
                if (!file) throw new Error('Choose a PDF document to upload.')
                await api.uploadAdminLearningMaterial(input, file)
                setSuccess('PDF uploaded and content processing has started. It will appear for assigned students automatically when processing is complete.')
            }
            resetForm()
            await load()
        } catch (caught) {
            setError(errorMessage(caught, 'Learning material could not be saved.'))
        } finally {
            setBusy(false)
        }
    }

    async function updateStatus(row: Row, status: 'draft' | 'published' | 'retired') {
        setBusy(true)
        setError('')
        setSuccess('')
        try {
            await api.setLearningMaterialStatus(value(row, 'id'), status)
            setSuccess(`Material ${status}.`)
            await loadMaterials(search)
        } catch (caught) {
            setError(errorMessage(caught, 'Material status could not be changed.'))
        } finally {
            setBusy(false)
        }
    }

    async function retry(row: Row) {
        setBusy(true)
        setError('')
        setSuccess('')
        try {
            await api.retryLearningMaterial(value(row, 'id'))
            setSuccess('Processing retry started.')
            await loadMaterials(search)
        } catch (caught) {
            setError(errorMessage(caught, 'Processing retry could not be started.'))
        } finally {
            setBusy(false)
        }
    }

    async function remove(row: Row) {
        if (!window.confirm(`Delete "${value(row, 'title')}" and its indexed content?`)) return
        setBusy(true)
        setError('')
        setSuccess('')
        try {
            await api.deleteLearningMaterial(value(row, 'id'))
            setSuccess('Learning material deleted.')
            await loadMaterials(search)
        } catch (caught) {
            setError(errorMessage(caught, 'Learning material could not be deleted.'))
        } finally {
            setBusy(false)
        }
    }

    async function openPdf(row: Row, download: boolean) {
        setError('')
        const popup = download ? null : window.open('', '_blank')
        try {
            const blob = await api.adminLearningMaterialFile(value(row, 'id'))
            const objectUrl = URL.createObjectURL(blob)
            if (download) {
                const anchor = document.createElement('a')
                anchor.href = objectUrl
                anchor.download = value(row, 'original_filename') || `${value(row, 'title')}.pdf`
                anchor.click()
            } else if (popup) {
                popup.opener = null
                popup.location.href = objectUrl
            } else {
                throw new Error('Allow pop-ups to preview this PDF, or choose Download.')
            }
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
        } catch (caught) {
            popup?.close()
            setError(errorMessage(caught, 'The PDF could not be opened.'))
        }
    }

    const subjectOptions = tvetGrade ? tvetSubjects : curriculumSubjects

    return <div className="learning-materials-management">
        <section className="admin-panel admin-full-panel">
            <div className="section-heading compact">
                <div><p className="eyebrow">Admin publishing</p><h2>Learning materials</h2></div>
                <button className="secondary-button" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>
            </div>
            <p className="admin-empty">PDF files are stored outside PostgreSQL. Materials that finish processing and match a learner’s school, class, program and enrolled subjects appear automatically on student dashboards and in AI answers.</p>
            {error && <p className="learning-material-notice error" role="alert">{error}</p>}
            {success && <p className="learning-material-notice success" role="status">{success}</p>}
            <label className="admin-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, description, school or subject" /></label>
            {loading ? <p className="admin-empty"><LoaderCircle className="education-spin" size={18} /> Loading learning materials...</p> : <div className="admin-table learning-material-table">
                {rows.map((row) => {
                    const processing = value(row, 'processing_status')
                    const status = value(row, 'status')
                    return <article className="admin-table-row" key={value(row, 'id')}>
                        <div className="learning-material-summary">
                            <strong><FileText size={16} /> {value(row, 'title')}</strong>
                            <small>{value(row, 'material_type').replaceAll('_', ' ')} · {value(row, 'school_name')} · {value(row, 'education_level_name')}{value(row, 'grade_name') ? ` / ${value(row, 'grade_name')}` : ''}{value(row, 'program_name') ? ` · ${value(row, 'program_name')}` : ''}{value(row, 'subject_name') ? ` · ${value(row, 'subject_name')}` : ''}</small>
                            {value(row, 'description') && <small>{value(row, 'description')}</small>}
                            {processing === 'failed' && <small className="learning-material-error">{value(row, 'processing_error')}</small>}
                        </div>
                        <span className={`status-pill ${status === 'published' ? 'published' : 'draft'}`}>{status}</span>
                        <span className={`learning-processing-state ${processing}`} aria-label={`Processing ${processing}`}>{processing === 'processing' && <LoaderCircle className="education-spin" size={14} />}{processing}</span>
                        <div className="admin-table-actions">
                            {value(row, 'source_type') === 'upload' ? <>
                                <button onClick={() => void openPdf(row, false)}>Preview</button>
                                <button onClick={() => void openPdf(row, true)}>Download</button>
                            </> : <a href={value(row, 'url')} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open URL</a>}
                            <button disabled={busy} onClick={() => edit(row)} aria-label={`Edit ${value(row, 'title')}`}><Pencil size={14} /></button>
                            {processing === 'failed' && <button disabled={busy} onClick={() => void retry(row)} aria-label={`Retry processing ${value(row, 'title')}`}><RotateCcw size={14} /></button>}
                            {status === 'published' ? <button disabled={busy} onClick={() => void updateStatus(row, 'draft')}>Unpublish</button> : <button disabled={busy || processing !== 'completed'} onClick={() => void updateStatus(row, 'published')}>Publish</button>}
                            <button disabled={busy} onClick={() => void remove(row)} aria-label={`Delete ${value(row, 'title')}`}><Trash2 size={14} /></button>
                        </div>
                    </article>
                })}
                {!rows.length && <p className="admin-empty">No learning materials found.</p>}
            </div>}
        </section>

        <section className="admin-panel admin-full-panel" id="learning-material-editor">
            <p className="eyebrow">Resource details and assignment</p>
            <h2>{editingId ? 'Update learning material' : 'Add learning material'}</h2>
            {!editingId && <div className="learning-material-source-tabs" role="tablist" aria-label="Resource type">
                <button type="button" className={sourceType === 'upload' ? 'active' : ''} onClick={() => setSourceType('upload')}><Upload size={15} /> Upload PDF</button>
                <button type="button" className={sourceType === 'url' ? 'active' : ''} onClick={() => setSourceType('url')}><ExternalLink size={15} /> Add URL</button>
            </div>}
            <form className="admin-create-form learning-material-form" onSubmit={(event) => void submit(event)}>
                <div className="learning-material-fields">
                    <label className="admin-field">Title<input required maxLength={240} value={form.title} onChange={(event) => setField('title', event.target.value)} /></label>
                    <label className="admin-field">Description<textarea maxLength={4000} rows={2} value={form.description} onChange={(event) => setField('description', event.target.value)} /></label>
                    <label className="admin-field">Document type<select value={form.materialType} onChange={(event) => setField('materialType', event.target.value)}>{materialTypes.map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}</select></label>
                    {sourceType === 'upload' && <label className="admin-field">{editingId ? 'Replace PDF (optional)' : 'PDF document'}<input required={!editingId} type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} /><small>PDF only · maximum 15 MB. Scanned PDFs without selectable text will fail processing.{editingId ? ' Leave empty to update metadata only.' : ''}</small></label>}
                    {sourceType === 'url' && <label className="admin-field">Learning resource URL<input required type="url" maxLength={4000} placeholder="https://…" value={form.url} onChange={(event) => setField('url', event.target.value)} /><small>Public HTML, plain text and text-based PDFs are supported. Private, blocked, scanned and unsupported pages will show an error.</small></label>}
                    <fieldset className="admin-target-selector learning-material-target">
                        <legend>School and curriculum assignment</legend>
                        <label className="admin-field">School<select required value={form.schoolId} onChange={(event) => setField('schoolId', event.target.value)}><option value="">Choose school</option>{schools.filter((school) => value(school, 'status') === 'active').map((school) => <option key={value(school, 'id')} value={value(school, 'id')}>{value(school, 'name')}</option>)}</select></label>
                        <label className="admin-field">Education level<select required value={form.educationLevelId} onChange={(event) => setForm((current) => ({ ...current, educationLevelId: event.target.value, gradeId: '', subjectId: '', tvetSubjectId: '' }))}><option value="">Choose level</option>{taxonomy.levels.map((level) => <option key={value(level, 'id')} value={value(level, 'id')}>{value(level, 'name')}</option>)}</select></label>
                        <label className="admin-field">Class / level<select value={form.gradeId} onChange={(event) => setForm((current) => ({ ...current, gradeId: event.target.value, programId: '', subjectId: '', tvetSubjectId: '' }))}><option value="">All classes at this level</option>{grades.map((grade) => <option key={value(grade, 'id')} value={value(grade, 'id')}>{value(grade, 'name')}</option>)}</select></label>
                        <label className="admin-field">{tvetGrade ? 'TVET program' : 'Program'}<select value={form.programId} onChange={(event) => setForm((current) => ({ ...current, programId: event.target.value, subjectId: '', tvetSubjectId: '' }))}><option value="">{tvetGrade ? programs.length ? 'Choose TVET program' : 'No TVET programs mapped to this level' : 'No program'}</option>{programs.map((program) => <option key={value(program, 'id')} value={value(program, 'id')}>{value(program, 'name')}</option>)}</select></label>
                        <label className="admin-field">Subject<select value={tvetGrade ? form.tvetSubjectId : form.subjectId} onChange={(event) => setForm((current) => ({ ...current, subjectId: tvetGrade ? '' : event.target.value, tvetSubjectId: tvetGrade ? event.target.value : '' }))}><option value="">Whole class/program</option>{subjectOptions.map((subject) => <option key={value(subject, 'id')} value={value(subject, 'id')}>{value(subject, 'name')}</option>)}</select></label>
                    </fieldset>
                    <label className="admin-field">Source citation (optional)<input maxLength={2000} value={form.sourceReference} onChange={(event) => setField('sourceReference', event.target.value)} /></label>
                    <label className="learning-material-rights"><input type="checkbox" checked={form.rightsConfirmed === 'true'} onChange={(event) => setField('rightsConfirmed', String(event.target.checked))} /><span>I confirm my school or organization has the right to upload, process, and share this resource with the selected learners.</span></label>
                </div>
                <div className="learning-material-form-actions"><button className="primary-button" disabled={busy || loading || form.rightsConfirmed !== 'true'}>{busy ? <><LoaderCircle className="education-spin" size={15} /> Saving…</> : editingId ? 'Update material' : sourceType === 'upload' ? <><Upload size={15} /> Upload and process PDF</> : 'Validate and process URL'}</button>{editingId && <button type="button" className="secondary-button" disabled={busy} onClick={resetForm}>Cancel edit</button>}</div>
            </form>
        </section>
    </div>
}
