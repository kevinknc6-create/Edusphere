import { useEffect } from 'react'
import { setAccessToken, setStoredUser, type ApiSession } from '../lib/api'

type HtmlLoginScreenProps = {
    onSuccess: (session: ApiSession) => void
    onTeacherLogin: () => void
}

export default function HtmlLoginScreen({ onSuccess, onTeacherLogin }: HtmlLoginScreenProps) {
    useEffect(() => {
        function handleMessage(event: MessageEvent) {
            if (event.origin !== window.location.origin || event.data?.type !== 'edusphere-auth-success') return
            const incoming = event.data.session as { accessToken?: string; user?: { id: string; email: string; fullName?: string; name?: string; role: ApiSession['user']['role'] } }
            if (!incoming.accessToken || !incoming.user) return
            setAccessToken(incoming.accessToken)
            const user: ApiSession['user'] = {
                id: incoming.user.id,
                email: incoming.user.email,
                fullName: incoming.user.fullName || incoming.user.name || incoming.user.email.split('@')[0],
                role: incoming.user.role,
            }
            setStoredUser(user)
            onSuccess({
                accessToken: incoming.accessToken,
                user,
            })
        }
        window.addEventListener('message', handleMessage)
        return () => window.removeEventListener('message', handleMessage)
    }, [onSuccess])

    return <div className="html-login-shell"><iframe className="html-login-iframe" title="EduSphere sign in" src="/login/index.html" /><button className="teacher-login-link" type="button" onClick={onTeacherLogin}>Teacher sign in</button></div>
}
