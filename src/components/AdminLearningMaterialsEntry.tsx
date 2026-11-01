import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import LearningMaterialsManagement from './LearningMaterialsManagement'

export default function AdminLearningMaterialsEntry() {
    const [access, setAccess] = useState<'checking' | 'allowed' | 'denied'>('checking')
    const [error, setError] = useState('')

    useEffect(() => {
        let active = true
        api.currentUser().then(({ data }) => {
            if (!active) return
            if (data.role !== 'admin' && data.role !== 'super-admin') {
                setError('Administrator access is required to manage learning materials.')
                setAccess('denied')
                return
            }
            setAccess('allowed')
        }).catch((caught: unknown) => {
            if (!active) return
            setError(caught instanceof Error ? caught.message : 'Administrator access could not be verified.')
            setAccess('denied')
        })
        return () => { active = false }
    }, [])

    if (access === 'checking') return <div className="admin-access-state" role="status">Verifying administrator access…</div>
    if (access === 'denied') return <section className="admin-access-state" role="alert">
        <h1>Learning Materials access denied</h1>
        <p>{error}</p>
        <a href="/Admin%20Dashboard.html">Return to Admin Dashboard</a>
    </section>
    return <main className="admin-page"><LearningMaterialsManagement /></main>
}
