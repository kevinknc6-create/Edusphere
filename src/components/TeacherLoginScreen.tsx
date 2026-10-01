import { useState, type FormEvent } from 'react'
import { ArrowLeft, CheckCircle2, GraduationCap, LoaderCircle, Mail, ShieldCheck } from 'lucide-react'
import { api, type ApiSession } from '../lib/api'

type TeacherLoginScreenProps = { onSuccess: (session: ApiSession) => void; onBack: () => void }

export default function TeacherLoginScreen({ onSuccess, onBack }: TeacherLoginScreenProps) {
    const [email, setEmail] = useState('')
    const [code, setCode] = useState('')
    const [step, setStep] = useState<'email' | 'code'>('email')
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)

    async function requestCode(event: FormEvent) {
        event.preventDefault(); setBusy(true); setError(''); setMessage('')
        try { const result = await api.requestTeacherCode(email.trim()); setMessage(result.message); setStep('code') } catch (caught) { setError(caught instanceof Error ? caught.message : 'Teacher verification could not be started.') } finally { setBusy(false) }
    }
    async function verifyCode(event: FormEvent) {
        event.preventDefault(); setBusy(true); setError('')
        try { onSuccess(await api.verifyTeacherCode(email.trim(), code.trim())) } catch (caught) { setError(caught instanceof Error ? caught.message : 'The verification code is invalid.') } finally { setBusy(false) }
    }
    return <div className="auth-shell teacher-auth-screen"><div className="auth-visual"><div className="brand"><span className="brand-mark"><GraduationCap size={18} /></span><span>Edu<span>Sphere</span></span></div><div className="auth-quote"><ShieldCheck size={25} /><h1>Teach with<br /><em>confidence.</em></h1><p>Your approved teacher workspace, courses, classes, and learner progress.</p></div></div><main className="auth-form-wrap"><div className="auth-form"><div className="mobile-auth-brand brand"><span className="brand-mark"><GraduationCap size={18} /></span><span>Edu<span>Sphere</span></span></div><button className="back-button" type="button" onClick={onBack}><ArrowLeft size={15} /> Student sign in</button><div className="auth-heading"><p className="eyebrow">Teacher access</p><h2>{step === 'email' ? 'Sign in to teach' : 'Enter your verification code'}</h2><p>{step === 'email' ? 'Use the email approved by your Edusphere administrator.' : `We sent a six-digit code to ${email}.`}</p></div>{error && <div className="auth-error" role="alert">{error}</div>}{message && <div className="auth-message" role="status"><CheckCircle2 size={15} /> {message}</div>}{step === 'email' ? <form onSubmit={requestCode}><label>Approved teacher email<div className="password-input"><Mail size={16} /><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teacher@example.com" autoComplete="email" /></div></label><button className="primary-button auth-submit" disabled={busy}>{busy ? <LoaderCircle className="education-spin" size={16} /> : <Mail size={16} />} Send verification code</button></form> : <form onSubmit={verifyCode}><label>Verification code<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="000000" autoComplete="one-time-code" /></label><button className="primary-button auth-submit" disabled={busy || code.length !== 6}>{busy ? <LoaderCircle className="education-spin" size={16} /> : <ShieldCheck size={16} />} Verify and open dashboard</button><button className="forgot-link" type="button" disabled={busy} onClick={() => void requestCode({ preventDefault() { } } as FormEvent)}>Resend code</button></form>}<p className="secure-note"><ShieldCheck size={13} /> Codes expire and can be used only once.</p></div></main></div>
}
