import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Check, GraduationCap, LoaderCircle, School, Sparkles } from 'lucide-react'
import { api, type EducationTaxonomy } from '../lib/api'

type EducationOnboardingProps = { onComplete: () => void }
type Category = 'primary' | 'secondary' | 'tvet' | 'university'

const categories: Array<{ id: Category; label: string; description: string; icon: typeof School }> = [
    { id: 'primary', label: 'Primary', description: 'Build a strong foundation for curious young learners.', icon: School },
    { id: 'secondary', label: 'Secondary', description: 'Strengthen your skills and prepare for what comes next.', icon: BookOpen },
    { id: 'tvet', label: 'TVET / SOD', description: 'Learn practical skills for work, craft, and technology.', icon: GraduationCap },
    { id: 'university', label: 'University', description: 'Shape a focused path around your field and program.', icon: Sparkles },
]

function categoryForLevel(level: { name: string; code: string }): Category | null {
    const value = `${level.code} ${level.name}`.toLowerCase()
    if (value.includes('primary')) return 'primary'
    if (value.includes('secondary') || value.includes('senior')) return 'secondary'
    if (value.includes('tvet') || value.includes('sod') || /(^|[^a-z])l[345]([^a-z]|$)/.test(value)) return 'tvet'
    if (value.includes('university') || value.includes('higher')) return 'university'
    return null
}

export default function EducationOnboarding({ onComplete }: EducationOnboardingProps) {
    const [taxonomy, setTaxonomy] = useState<EducationTaxonomy | null>(null)
    const [category, setCategory] = useState<Category | null>(null)
    const [levelId, setLevelId] = useState('')
    const [gradeId, setGradeId] = useState('')
    const [programId, setProgramId] = useState('')
    const [error, setError] = useState('')
    const [saving, setSaving] = useState(false)
    const university = category === 'university'
    const tvet = category === 'tvet'

    useEffect(() => {
        api.taxonomy().then((result) => setTaxonomy(result.data)).catch(() => setError('We could not load the education options. Please try again.'))
    }, [])

    const levels = useMemo(() => taxonomy?.levels.filter((level) => category && categoryForLevel(level) === category) || [], [taxonomy, category])
    const grades = taxonomy?.grades.filter((grade) => grade.education_level_id === levelId) || []
    const programs = useMemo(() => {
        const available = taxonomy?.programs || []
        if (tvet) return available.filter((program) => program.grade_ids?.includes(gradeId))
        if (university) return available.filter((program) => !program.grade_ids?.length)
        return available
    }, [taxonomy, gradeId, tvet, university])
    const canSave = Boolean(levelId && (!grades.length || gradeId) && (!university && !tvet || programId))
    const step = !category ? 1 : !levelId ? 2 : tvet && !gradeId ? 3 : 3

    function chooseCategory(next: Category) {
        setCategory(next)
        setLevelId('')
        setGradeId('')
        setProgramId('')
        setError('')
    }

    function chooseLevel(next: string) {
        setLevelId(next)
        setGradeId('')
        setProgramId('')
        setError('')
    }

    async function save() {
        if (!canSave) return
        setSaving(true)
        setError('')
        try {
            await api.updateEducationProfile({ educationLevelId: levelId, gradeId: gradeId || null, programId: programId || null })
            localStorage.setItem('edusphere-education-level', levels.find((level) => level.id === levelId)?.name || 'the learner current education level')
            localStorage.setItem('edusphere-education-grade', grades.find((grade) => grade.id === gradeId)?.name || '')
            localStorage.setItem('edusphere-education-program', programs.find((program) => program.id === programId)?.name || '')
            localStorage.setItem('edusphere-education-profile-complete', 'true')
            onComplete()
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Your education profile could not be saved.')
        } finally {
            setSaving(false)
        }
    }

    return <main className="education-onboarding">
        <div className="education-onboarding-glow" />
        <header className="education-onboarding-header"><div className="education-brand"><span><Sparkles size={16} /></span>Edu<span>Sphere</span></div><span className="education-step">Step {step} of 3</span></header>
        <section className="education-onboarding-content">
            <div className="education-intro"><span className="education-eyebrow"><Sparkles size={14} /> Personalize your learning path</span><h1>Where are you<br /><em>on your journey?</em></h1><p>Choose your education level so Edusphere can bring the right subjects, courses, and explanations closer to you.</p></div>
            <div className="education-progress"><i className={step >= 1 ? 'active' : ''} /><i className={step >= 2 ? 'active' : ''} /><i className={step >= 3 ? 'active' : ''} /></div>
            {!category ? <div className="education-choice-view">
                <div className="education-section-title"><span>01</span><div><strong>Choose your education stage</strong><small>You can change this later in Settings.</small></div></div>
                <div className="education-category-grid">{categories.map(({ id, label, description, icon: Icon }) => <button className="education-category-card" key={id} onClick={() => chooseCategory(id)}><span className={`education-category-icon ${id}`}><Icon size={22} /></span><span><strong>{label}</strong><small>{description}</small></span><ArrowRight size={17} /></button>)}</div>
            </div> : <div className="education-choice-view">
                <button className="education-back" onClick={() => setCategory(null)}><ArrowLeft size={15} /> Back to education stage</button>
                <div className="education-section-title"><span>0{university ? 3 : 2}</span><div><strong>{university ? 'Choose your field and program' : tvet ? 'Choose your TVET level and program' : `Choose your ${category} class`}</strong><small>{tvet ? 'Your program determines the subjects and courses you see.' : 'This helps us tune your learning experience.'}</small></div></div>
                {levels.length > 0 && <div className="education-level-grid">{levels.map((level) => <button className={levelId === level.id ? 'selected' : ''} key={level.id} onClick={() => chooseLevel(level.id)}><span>{level.name}</span>{levelId === level.id && <Check size={16} />}</button>)}</div>}
                {levelId && !university && <div className="education-subchoice"><label htmlFor="education-grade">{tvet ? 'TVET level' : 'Class or grade'}</label><select id="education-grade" value={gradeId} onChange={(event) => { setGradeId(event.target.value); setProgramId('') }}><option value="">Select an option</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}</select></div>}
                {levelId && (university || tvet && gradeId) && <div className="education-subchoice"><label htmlFor="education-program">{tvet ? 'TVET program' : 'Program or field'}</label><select id="education-program" value={programId} onChange={(event) => setProgramId(event.target.value)}><option value="">Select a program</option>{programs.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}</select>{tvet && !programs.length && <small>No programs are available for this level yet.</small>}</div>}
                {error && <p className="education-form-error" role="alert">{error}</p>}
                <div className="education-action-row"><button className="education-back secondary" onClick={() => setCategory(null)}>Change stage</button><button className="education-continue" disabled={!canSave || saving} onClick={save}>{saving ? <LoaderCircle size={16} className="education-spin" /> : <ArrowRight size={16} />} {saving ? 'Saving...' : 'Enter My Learning Space'}</button></div>
            </div>}
        </section>
    </main>
}
