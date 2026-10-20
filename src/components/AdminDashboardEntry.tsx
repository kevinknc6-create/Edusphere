import { useEffect, useState, type FormEvent } from 'react'
import AdminWorkspace from './AdminWorkspace'
import { api, setAccessToken, setStoredUser } from '../lib/api'
import type { ApiSession } from '../lib/api'

export default function AdminDashboardEntry() {
    const [user, setUser] = useState<ApiSession['user'] | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [email, setEmail] = useState('kevinknc6@gmail.com')
    const [password, setPassword] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [attempt, setAttempt] = useState(0)

    function setHeaderState(account: ApiSession['user'] | null) {
        const name = document.getElementById('topName')
        const role = document.getElementById('topRole')
        const avatar = document.getElementById('topAvatar')
        const footer = document.getElementById('footL')
        const logoutButton = document.getElementById('logoutBtn')
        if (name) name.textContent = account?.fullName || 'Administrator sign in'
        if (role) role.textContent = account ? account.role === 'super-admin' ? 'Super Admin' : 'Administrator' : ''
        if (avatar) avatar.textContent = account ? account.fullName.split(/\s+/).map((part) => part[0] || '').slice(0, 2).join('').toUpperCase() : ''
        if (footer) footer.textContent = `EduSphere © ${new Date().getFullYear()}. All rights reserved.`
        if (logoutButton) logoutButton.hidden = !account
    }

    useEffect(() => {
        let active = true
        api.currentUser().then(({ data }) => {
            if (!active) return
            if (data.role !== 'admin' && data.role !== 'super-admin') {
                setError('Administrator access is required for this page.')
                setHeaderState(null)
                return
            }
            setUser(data)
            setHeaderState(data)
        }).catch(() => {
            if (active) {
                setAccessToken(null)
                setStoredUser(null)
                setUser(null)
                setHeaderState(null)
            }
        }).finally(() => {
            if (active) setLoading(false)
        })
        return () => { active = false }
    }, [attempt])

    async function signIn(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setSubmitting(true)
        setError('')
        try {
            await api.login({ email: email.trim(), password })
            const { data } = await api.currentUser()
            if (data.role !== 'admin' && data.role !== 'super-admin') {
                await api.logout()
                throw new Error('This account does not have administrator access.')
            }
            setUser(data)
            setPassword('')
            setHeaderState(data)
        } catch (caught) {
            setAccessToken(null)
            setStoredUser(null)
            setPassword('')
            setError(caught instanceof Error ? caught.message : 'Sign in could not be completed.')
        } finally {
            setSubmitting(false)
        }
    }

    useEffect(() => {
        const logoutButton = document.getElementById('logoutBtn')
        const themeButton = document.getElementById('themeBtn')
        const menuButton = document.getElementById('menuBtn')
        const sidebar = document.getElementById('sidebar')
        const scrim = document.getElementById('scrim')
        if (menuButton) menuButton.textContent = '☰'
        if (themeButton) themeButton.textContent = document.documentElement.dataset.theme === 'dark' ? '☀' : '☾'
        const toggleMenu = () => {
            const open = !sidebar?.classList.contains('open')
            sidebar?.classList.toggle('open', open)
            scrim?.classList.toggle('show', open)
            menuButton?.setAttribute('aria-expanded', String(open))
        }
        const closeMenu = () => {
            sidebar?.classList.remove('open')
            scrim?.classList.remove('show')
            menuButton?.setAttribute('aria-expanded', 'false')
        }
        const logout = () => {
            void api.logout().catch((caught: unknown) => {
                setError(caught instanceof Error ? caught.message : 'Sign out could not be completed.')
            }).finally(() => { window.top?.location.replace('/') })
        }
        const toggleTheme = () => {
            const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
            document.documentElement.dataset.theme = next
            if (themeButton) themeButton.textContent = next === 'dark' ? '☀' : '☾'
            try {
                const current = JSON.parse(localStorage.getItem('edusphere.prefs.v1') || '{}') as Record<string, unknown>
                localStorage.setItem('edusphere.prefs.v1', JSON.stringify({ ...current, theme: next }))
            } catch {
                setError('The theme preference could not be saved in this browser.')
            }
        }
        logoutButton?.addEventListener('click', logout)
        themeButton?.addEventListener('click', toggleTheme)
        menuButton?.addEventListener('click', toggleMenu)
        scrim?.addEventListener('click', closeMenu)
        return () => {
            logoutButton?.removeEventListener('click', logout)
            themeButton?.removeEventListener('click', toggleTheme)
            menuButton?.removeEventListener('click', toggleMenu)
            scrim?.removeEventListener('click', closeMenu)
        }
    }, [])

    if (loading) return <div className="admin-access-state" role="status">Verifying administrator access…</div>
    if (!user) return <section className="admin-access-state admin-login-state">
        <p className="eyebrow">Secure administrator access</p>
        <h1>Sign in to EduSphere Admin</h1>
        {error && <p className="admin-login-error" role="alert">{error}</p>}
        <form onSubmit={(event) => void signIn(event)}>
            <label htmlFor="adminEmail">Email</label>
            <input id="adminEmail" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
            <label htmlFor="adminPassword">Password</label>
            <input id="adminPassword" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Verifying…' : 'Sign in'}</button>
        </form>
        <button className="secondary-button" onClick={() => { setLoading(true); setError(''); setAttempt((value) => value + 1) }}>Check existing session</button>
    </section>

    return <AdminWorkspace role={user.role} navigationTargetId="nav" />
}
