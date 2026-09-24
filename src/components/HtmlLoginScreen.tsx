import { useEffect } from 'react'
import { setAccessToken, type ApiSession } from '../lib/api'

type AuthMode = 'login' | 'register'

type HtmlLoginScreenProps = {
    mode: AuthMode
    onModeChange: (mode: AuthMode) => void
    onSuccess: (session: ApiSession) => void
}

export default function HtmlLoginScreen({ mode, onModeChange, onSuccess }: HtmlLoginScreenProps) {
    useEffect(() => {
        function handleMessage(event: MessageEvent) {
            if (event.origin !== window.location.origin || event.data?.type !== 'edusphere-auth-success') return
            const incoming = event.data.session as { accessToken?: string; user?: { id: string; email: string; fullName?: string; name?: string; role: ApiSession['user']['role'] } }
            if (!incoming.accessToken || !incoming.user) return
            setAccessToken(incoming.accessToken)
            onSuccess({
                accessToken: incoming.accessToken,
                user: {
                    id: incoming.user.id,
                    email: incoming.user.email,
                    fullName: incoming.user.fullName || incoming.user.name || incoming.user.email.split('@')[0],
                    role: incoming.user.role,
                },
            })
        }
        window.addEventListener('message', handleMessage)
        return () => window.removeEventListener('message', handleMessage)
    }, [onSuccess])

    useEffect(() => {
        function handleModeMessage(event: MessageEvent) {
            if (event.origin === window.location.origin && event.data?.type === 'edusphere-create-account') onModeChange('register')
        }
        window.addEventListener('message', handleModeMessage)
        return () => window.removeEventListener('message', handleModeMessage)
    }, [onModeChange])

    void mode

    return <iframe className="html-login-iframe" title="EduSphere sign in" src="/edusphere-login%20(20).html" />
}
