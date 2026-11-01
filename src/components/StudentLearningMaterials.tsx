import { useState } from 'react'
import { Download, ExternalLink, FileText, LoaderCircle } from 'lucide-react'
import { api, type LearningMaterial } from '../lib/api'

export default function StudentLearningMaterials({ materials }: { materials: LearningMaterial[] }) {
    const [openingId, setOpeningId] = useState('')
    const [error, setError] = useState('')

    async function openPdf(material: LearningMaterial, download: boolean) {
        const popup = download ? null : window.open('', '_blank')
        setOpeningId(material.id)
        setError('')
        try {
            const blob = await api.studentLearningMaterialFile(material.id)
            const objectUrl = URL.createObjectURL(blob)
            if (download) {
                const anchor = document.createElement('a')
                anchor.href = objectUrl
                anchor.download = material.original_filename || `${material.title}.pdf`
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
            setError(caught instanceof Error ? caught.message : 'The learning material could not be opened.')
        } finally {
            setOpeningId('')
        }
    }

    if (!materials.length) return null
    return <div className="curriculum-material-list">
        {error && <p className="learning-material-notice error" role="alert">{error}</p>}
        {materials.map((material) => <article className="curriculum-material-card" key={material.id}>
            <FileText size={19} />
            <div className="student-material-copy">
                <strong>{material.title}</strong>
                <small>{material.material_type.replaceAll('_', ' ')}{material.subject_name ? ` · ${material.subject_name}` : ''}{material.unit_name ? ` · ${material.unit_name}` : ''}{material.lesson_name ? ` · ${material.lesson_name}` : ''}</small>
                {material.description && <small>{material.description}</small>}
            </div>
            {material.source_type === 'upload'
                ? <div className="student-material-actions">
                    <button className="curriculum-open-button" disabled={openingId === material.id} onClick={() => void openPdf(material, false)}>{openingId === material.id ? <LoaderCircle className="education-spin" size={14} /> : <FileText size={14} />} Preview</button>
                    <button className="curriculum-open-button" disabled={openingId === material.id} onClick={() => void openPdf(material, true)}><Download size={14} /> Download</button>
                </div>
                : <a href={material.url} target="_blank" rel="noreferrer">Open resource <ExternalLink size={14} /></a>}
        </article>)}
    </div>
}
