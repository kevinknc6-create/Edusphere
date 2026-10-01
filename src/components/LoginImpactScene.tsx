import { useEffect } from 'react'

type LoginImpactSceneProps = {
    onReveal: () => void
}

export default function LoginImpactScene({ onReveal }: LoginImpactSceneProps) {
    useEffect(() => {
        onReveal()
    }, [onReveal])

    return <div className="auth-scene-effects" aria-hidden="true">
        <div className="auth-school-lights" />
        <div className="auth-floor" />
        <div className="auth-impact-point" />
        <div className="auth-energy" />
        <div className="auth-rays" />
        <div className="auth-particles" />
        <div className="auth-cracks" />
        <div className="auth-student">
            <span className="student-shadow" />
            <span className="student-head" />
            <span className="student-body" />
            <span className="student-strap student-strap-left" />
            <span className="student-strap student-strap-right" />
            <span className="student-leg student-leg-left" />
            <span className="student-leg student-leg-right" />
            <span className="student-bag" />
        </div>
    </div>
}
