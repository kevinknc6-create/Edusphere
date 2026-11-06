import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BookOpen, ExternalLink, LoaderCircle, Plus, Send, Sparkles, X } from 'lucide-react'
import { api } from '../lib/api'

type Citation = { id: string; title: string; reference: string; url: string }
type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; citations?: Citation[] }

const suggestions = [
    'Explain a topic from my PDF simply',
    'Explain a difficult word in my notes',
    'Give me an example from my lesson',
]

export default function StudentAiTutor({ primary = false }: { primary?: boolean }) {
    const [message, setMessage] = useState('')
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [openingId, setOpeningId] = useState('')
    const [isOpen, setIsOpen] = useState(false)
    const endOfMessages = useRef<HTMLDivElement>(null)

    useEffect(() => {
        endOfMessages.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, [messages, busy])

    async function ask(question: string) {
        const prompt = question.trim()
        if (!prompt || busy) return
        setBusy(true)
        setError('')
        try {
            const history = messages.slice(-10).map(({ role, content }) => ({ role, content }))
            const result = await api.aiChat({ message: prompt, history })
            setMessages((current) => [
                ...current,
                { id: crypto.randomUUID(), role: 'user', content: prompt },
                {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content: result.data.answer,
                    citations: result.data.citations || [],
                },
            ])
            setMessage('')
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'The AI Tutor is temporarily unavailable.')
        } finally {
            setBusy(false)
        }
    }

    function submit(event: FormEvent) {
        event.preventDefault()
        void ask(message)
    }

    function startNewChat() {
        if (busy) return
        setMessages([])
        setMessage('')
        setError('')
    }

    async function openCitation(citation: Citation) {
        const popup = window.open('', '_blank')
        if (!popup) {
            setError('Allow pop-ups to open this source.')
            return
        }
        setOpeningId(citation.id)
        setError('')
        try {
            if (citation.url.startsWith('/api/student/materials/')) {
                const blob = await api.studentLearningMaterialFile(citation.id)
                const objectUrl = URL.createObjectURL(blob)
                popup.opener = null
                popup.location.href = objectUrl
                window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
            } else {
                popup.opener = null
                popup.location.href = citation.url
            }
        } catch (caught) {
            popup.close()
            setError(caught instanceof Error ? caught.message : 'The source could not be opened.')
        } finally {
            setOpeningId('')
        }
    }

    return <div className="student-ai-widget">
        {isOpen ? <section className="student-ai-chat" aria-label={primary ? 'AI Teacher' : 'AI Tutor'}>
            <header className="student-ai-chat-header">
                <div className="student-ai-chat-brand">
                    <span className="student-ai-chat-mark"><EduSphereLogoMark /></span>
                    <div>
                        <span className="student-section-label">{primary ? 'AI Teacher' : 'Edusphere AI'}</span>
                        <h2>Your learning companion</h2>
                    </div>
                </div>
                <div className="student-ai-header-actions">
                    <button className="student-ai-new-chat" type="button" onClick={startNewChat} disabled={busy}>
                        <Plus size={16} /> New chat
                    </button>
                    <button className="student-ai-close" type="button" onClick={() => setIsOpen(false)} aria-label="Close Edusphere AI">
                        <X size={17} />
                    </button>
                </div>
            </header>

            <div className="student-ai-chat-subtitle">
                <BookOpen size={15} />
                <p>Ask a question about your lessons. Edusphere AI looks in approved notes for your school and class, then explains the answer simply.</p>
            </div>

            <div className="student-ai-chat-thread" aria-live="polite" aria-relevant="additions text">
                {!messages.length && !busy && <div className="student-ai-welcome">
                    <span className="student-ai-welcome-icon"><Sparkles size={22} /></span>
                    <h3>What would you like to learn?</h3>
                    <p>Ask a question, request an example, or get help revising a topic.</p>
                    <div className="student-ai-suggestions">
                        {suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => void ask(suggestion)}>{suggestion}</button>)}
                    </div>
                </div>}
                {messages.map((item) => <article className={`student-ai-message ${item.role}`} key={item.id}>
                    {item.role === 'assistant' && <span className="student-ai-message-mark"><Sparkles size={15} /></span>}
                    <div className="student-ai-message-body">
                        <span className="student-ai-message-author">{item.role === 'assistant' ? 'Edusphere AI' : 'You'}</span>
                        <p>{item.content}</p>
                        {Boolean(item.citations?.length) && <div className="student-ai-citations">
                            <strong>Related learning materials</strong>
                            {item.citations?.map((citation) => <button key={citation.id} type="button" disabled={openingId === citation.id} onClick={() => void openCitation(citation)}>
                                {openingId === citation.id ? <LoaderCircle className="education-spin" size={13} /> : <ExternalLink size={13} />}
                                {citation.title}
                            </button>)}
                        </div>}
                    </div>
                </article>)}
                {busy && <div className="student-ai-message assistant" role="status">
                    <span className="student-ai-message-mark"><Sparkles size={15} /></span>
                    <div className="student-ai-message-body student-ai-thinking"><LoaderCircle className="education-spin" size={15} /> Edusphere AI is thinking…</div>
                </div>}
                <div ref={endOfMessages} />
            </div>

            {error && <p className="learning-material-notice error student-ai-chat-error" role="alert">{error}</p>}
            <form className="student-ai-chat-form" onSubmit={submit}>
                <textarea
                    value={message}
                    maxLength={4000}
                    rows={1}
                    onChange={(event) => setMessage(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault()
                            void ask(message)
                        }
                    }}
                    placeholder="Message Edusphere AI…"
                    aria-label="Message Edusphere AI"
                />
                <button type="submit" disabled={busy || !message.trim()} aria-label="Send message">
                    {busy ? <LoaderCircle className="education-spin" size={17} /> : <Send size={17} />}
                </button>
                <small>Enter to send · Shift + Enter for a new line</small>
            </form>
        </section> : <button
            className="student-ai-launcher"
            type="button"
            onClick={() => setIsOpen(true)}
            aria-label="Open Edusphere AI"
        >
            <span className="student-ai-launcher-mark"><EduSphereLogoMark /></span>
            <span>Edusphere AI</span>
        </button>}
    </div>
}

function EduSphereLogoMark() {
    return <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <defs>
            <linearGradient id="edusphere-ai-logo-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#34f5a5" />
                <stop offset="1" stopColor="#19d3da" />
            </linearGradient>
        </defs>
        <circle cx="24" cy="24" r="20" fill="none" stroke="url(#edusphere-ai-logo-gradient)" strokeWidth="2.5" />
        <ellipse cx="24" cy="24" rx="9" ry="20" fill="none" stroke="url(#edusphere-ai-logo-gradient)" strokeWidth="1.8" opacity=".75" />
        <path d="M4.5 24h39M8 14.5h32M8 33.5h32" stroke="url(#edusphere-ai-logo-gradient)" strokeWidth="1.6" opacity=".6" fill="none" />
        <circle cx="24" cy="24" r="3.4" fill="url(#edusphere-ai-logo-gradient)" />
    </svg>
}
