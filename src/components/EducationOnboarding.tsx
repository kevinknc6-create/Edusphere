import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { LoaderCircle, School, Sparkles } from 'lucide-react'
import { api, type EducationProfile, type EducationTaxonomy } from '../lib/api'

type SchoolOption = { id: string; name: string }
type EducationOnboardingProps = { onComplete: () => Promise<void>; initialProfile?: EducationProfile | null }

function isUniversity(level?: EducationTaxonomy['levels'][number]) {
    return `${level?.category || ''} ${level?.name || ''}`.toLowerCase().includes('university')
        || `${level?.category || ''} ${level?.name || ''}`.toLowerCase().includes('higher')
}

function isTvet(level?: EducationTaxonomy['levels'][number], gradeName = '') {
    return `${level?.category || ''} ${level?.name || ''}`.toLowerCase().includes('tvet')
        || `${level?.category || ''} ${level?.name || ''}`.toLowerCase().includes('sod')
        || /\bl[345]\b/i.test(gradeName)
        || /\bl[345]\b/i.test(level?.code || '')
        || /\bl[345]\b/i.test(level?.name || '')
}

export default function EducationOnboarding({ onComplete, initialProfile }: EducationOnboardingProps) {
    const [taxonomy, setTaxonomy] = useState<EducationTaxonomy | null>(null)
    const [schools, setSchools] = useState<SchoolOption[]>([])
    const [schoolId, setSchoolId] = useState(initialProfile?.school_id || '')
    const [levelId, setLevelId] = useState(initialProfile?.education_level_id || '')
    const [gradeId, setGradeId] = useState(initialProfile?.grade_id || '')
    const [programId, setProgramId] = useState(initialProfile?.program_id || '')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')

    useEffect(() => {
        let cancelled = false
        Promise.all([api.taxonomy(), api.educationSchools()])
            .then(([taxonomyResult, schoolResult]) => {
                if (cancelled) return
                setTaxonomy(taxonomyResult.data)
                setSchools(schoolResult.data)
            })
            .catch((caught) => {
                if (!cancelled) setError(caught instanceof Error ? caught.message : 'School, class and program options could not be loaded.')
            })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [])

    const selectedLevel = taxonomy?.levels.find((level) => level.id === levelId)
    const grades = useMemo(
        () => taxonomy?.grades.filter((grade) => grade.education_level_id === levelId) || [],
        [taxonomy, levelId],
    )
    const selectedGrade = grades.find((grade) => grade.id === gradeId)
    const programs = useMemo(() => taxonomy?.programs.filter((program) => {
        const gradeIds = program.grade_ids || []
        if (!isTvet(selectedLevel, selectedGrade?.code || selectedGrade?.name || '')) {
            return !gradeId || !gradeIds.length || gradeIds.includes(gradeId)
        }
        const tvetGradeIds = taxonomy.grades.filter((grade) => {
            const level = taxonomy.levels.find((item) => item.id === grade.education_level_id)
            return isTvet(level, grade.code || grade.name)
        }).map((grade) => grade.id)
        return gradeIds.length > 0 && (gradeId ? gradeIds.includes(gradeId) : gradeIds.some((id) => tvetGradeIds.includes(id)))
    }) || [], [taxonomy, gradeId, selectedLevel, selectedGrade])
    const university = isUniversity(selectedLevel)
    const programRequired = university || isTvet(selectedLevel, selectedGrade?.name)
    const gradeRequired = !university

    async function saveEducationProfile(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setSaving(true)
        setError('')
        try {
            await api.updateEducationProfile({
                educationLevelId: levelId,
                gradeId: gradeId || null,
                programId: programId || null,
                schoolId,
            })
            await onComplete()
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Your school and class could not be saved.')
        } finally {
            setSaving(false)
        }
    }

    return <main className="education-onboarding">
        <div className="education-onboarding-glow" />
        <header className="education-onboarding-header"><div className="education-brand"><span><Sparkles size={16} /></span>Edu<span>Sphere</span></div></header>
        <section className="education-onboarding-content">
            <div className="education-intro">
                <span className="education-eyebrow"><School size={14} /> Your learning profile</span>
                <h1>Choose your<br /><em>school and class.</em></h1>
                <p>Choose your school, education level, class and program to open your learning dashboard.</p>
            </div>
            <form className="education-choice-view" onSubmit={(event) => void saveEducationProfile(event)}>
                {loading ? <p role="status"><LoaderCircle className="education-spin" size={16} /> Loading school, class and program options…</p> : <>
                    <label className="admin-field">School
                        <select required disabled={Boolean(initialProfile?.school_id)} value={schoolId} onChange={(event) => setSchoolId(event.target.value)}>
                            <option value="">Choose your school</option>
                            {schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
                        </select>
                    </label>
                    {initialProfile?.school_id && initialProfile.school_status !== 'active' && <p role="alert">Your assigned school is inactive. Contact an administrator.</p>}
                    {!schools.length && <p role="alert">No active schools are available. Contact an administrator.</p>}
                    <label className="admin-field">Education level
                        <select required value={levelId} onChange={(event) => {
                            setLevelId(event.target.value)
                            setGradeId('')
                            setProgramId('')
                        }}>
                            <option value="">Choose your education level</option>
                            {(taxonomy?.levels || []).map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}
                        </select>
                    </label>
                    {!taxonomy?.levels.length && <p role="alert">No education levels are configured. Contact an administrator.</p>}
                    {!university && <label className="admin-field">Class / level
                        <select required={gradeRequired} disabled={!levelId} value={gradeId} onChange={(event) => {
                            setGradeId(event.target.value)
                            setProgramId('')
                        }}>
                            <option value="">Choose your class</option>
                            {grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}
                        </select>
                    </label>}
                    {levelId && !university && !grades.length && <p role="alert">No classes are configured for this education level. Contact an administrator.</p>}
                    {levelId && programRequired && <label className="admin-field">Program
                        <select required={programRequired} value={programId} onChange={(event) => setProgramId(event.target.value)}>
                            <option value="">Choose your program</option>
                            {programs.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}
                        </select>
                    </label>}
                    {levelId && programRequired && !programs.length && <p role="alert">No programs are configured for this selection. Contact an administrator.</p>}
                </>}
                {error && <p role="alert">{error}</p>}
                <button className="education-continue" type="submit" disabled={loading || saving || !taxonomy || !schools.length || !schoolId || Boolean(initialProfile?.school_id && initialProfile.school_status !== 'active')}>
                    {saving ? <><LoaderCircle className="education-spin" size={16} /> Saving…</> : 'Continue to learning'}
                </button>
            </form>
        </section>
    </main>
}
