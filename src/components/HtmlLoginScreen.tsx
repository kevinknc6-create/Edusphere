import { useEffect } from 'react'
import { setAccessToken, setStoredUser, type ApiSession } from '../lib/api'

type HtmlLoginScreenProps = {
    onSuccess: (session: ApiSession) => void
}

export default function HtmlLoginScreen({ onSuccess }: HtmlLoginScreenProps) {
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

    return <iframe className="html-login-iframe" title="EduSphere sign in" src="/login/index.html" />
}
