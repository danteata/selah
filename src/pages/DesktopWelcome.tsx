import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    BookOpen,
    Eye,
    EyeOff,
    Mail,
    Lock,
    User,
    ArrowRight,
    Mic,
    Church,
    Sparkles,
    Quote,
    Check,
} from 'lucide-react'
import { gsap } from '../lib/gsap'
import { useClerkAuth } from '../hooks/useClerkAuth'
import type { AuthMode } from '../hooks/useClerkAuth'

type SignupStep = 'account' | 'verify' | 'church'

const rotatingVerses = [
    { text: 'For God so loved the world that he gave his one and only Son…', ref: 'John 3:16' },
    { text: 'The Lord is my shepherd, I lack nothing.', ref: 'Psalm 23:1' },
    { text: 'Be still, and know that I am God.', ref: 'Psalm 46:10' },
    { text: 'I can do all things through Christ who strengthens me.', ref: 'Philippians 4:13' },
]

const demoTranscript = [
    { text: '…and as we reflect on the love of God, we turn to', delay: 0 },
    { text: 'John chapter three, verse sixteen —', delay: 2200, isVerse: true },
    { text: 'where we read that God so loved the world', delay: 4400 },
    { text: 'that he gave his one and only Son…', delay: 6400 },
]

const waveBars = Array.from({ length: 28 }, (_, i) => {
    const base = 18 + Math.abs(Math.sin(i * 0.65)) * 70
    return Math.round(base)
})

function getGreeting(): { headline: string; sub: string } {
    const hour = new Date().getHours()
    const partOfDay =
        hour < 5 ? 'evening' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'

    return {
        headline: `Good ${partOfDay}.`,
        sub: 'Your studio is ready whenever you are.',
    }
}

function LeftPanel() {
    const panelRef = useRef<HTMLDivElement>(null)
    const [verseIdx, setVerseIdx] = useState(0)
    const [transcriptIdx, setTranscriptIdx] = useState(0)
    const [showDetected, setShowDetected] = useState(false)
    const greeting = useMemo(() => getGreeting(), [])

    useEffect(() => {
        const verseTimer = setInterval(() => {
            setVerseIdx((i) => (i + 1) % rotatingVerses.length)
        }, 7000)
        return () => clearInterval(verseTimer)
    }, [])

    useEffect(() => {
        let mounted = true
        const run = () => {
            if (!mounted) return
            setTranscriptIdx(-1)
            setShowDetected(false)
            demoTranscript.forEach((line, i) => {
                setTimeout(() => {
                    if (!mounted) return
                    setTranscriptIdx(i)
                    if (line.isVerse) {
                        setTimeout(() => {
                            if (mounted) setShowDetected(true)
                        }, 700)
                    }
                }, line.delay + 400)
            })
        }
        run()
        const loop = setInterval(run, 11000)
        return () => {
            mounted = false
            clearInterval(loop)
        }
    }, [])

    useEffect(() => {
        const el = panelRef.current
        if (!el) return
        const ctx = gsap.context(() => {
            gsap.set(['.sw-brand', '.sw-badge', '.sw-headline-line', '.sw-sub', '.sw-mock', '.sw-verses', '.sw-foot'], {
                opacity: 0,
            })
            const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
            tl.to('.sw-brand', { opacity: 1, y: 0, duration: 0.7, delay: 0.1 })
                .fromTo('.sw-badge', { y: 16 }, { opacity: 1, y: 0, duration: 0.55 }, '-=0.45')
                .fromTo('.sw-headline-line', { y: 38 }, { opacity: 1, y: 0, duration: 0.75, stagger: 0.12 }, '-=0.3')
                .fromTo('.sw-sub', { y: 18 }, { opacity: 1, y: 0, duration: 0.6 }, '-=0.35')
                .fromTo('.sw-mock', { y: 28 }, { opacity: 1, y: 0, duration: 0.85 }, '-=0.35')
                .fromTo('.sw-verses', { y: 16 }, { opacity: 1, y: 0, duration: 0.55 }, '-=0.4')
                .fromTo('.sw-foot', { y: 8 }, { opacity: 1, y: 0, duration: 0.5 }, '-=0.3')
        }, el)
        return () => ctx.revert()
    }, [])

    return (
        <div
            ref={panelRef}
            className="hidden lg:flex lg:w-[58%] xl:w-[60%] relative flex-col overflow-hidden"
            style={{ background: '#08090c' }}
        >
            <div
                className="absolute inset-0 pointer-events-none animate-gradient-drift"
                style={{
                    background:
                        'radial-gradient(ellipse 70% 50% at 20% 15%, rgba(20,184,166,0.22), transparent 60%),' +
                        'radial-gradient(ellipse 60% 60% at 85% 80%, rgba(217,119,6,0.16), transparent 65%),' +
                        'radial-gradient(ellipse 50% 40% at 50% 55%, rgba(45,212,191,0.06), transparent 60%)',
                }}
            />

            <div
                className="absolute inset-0 pointer-events-none opacity-[0.05]"
                style={{
                    backgroundImage:
                        'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
                    backgroundSize: '56px 56px',
                }}
            />

            <div
                className="absolute inset-0 pointer-events-none opacity-30"
                style={{
                    background:
                        'linear-gradient(135deg, rgba(255,255,255,0.02) 0%, transparent 30%, transparent 70%, rgba(255,255,255,0.015) 100%)',
                }}
            />

            <div className="grain-overlay opacity-25" />

            <div className="relative z-10 flex-1 flex flex-col px-14 xl:px-20 py-10">
                <div className="sw-brand flex items-center gap-3 mb-10">
                    <div
                        className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-2xl"
                        style={{
                            background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                            boxShadow: '0 12px 40px -8px rgba(20,184,166,0.55), inset 0 1px 0 rgba(255,255,255,0.2)',
                        }}
                    >
                        <BookOpen className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <div className="text-2xl font-bold tracking-tight text-white font-serif leading-none">
                            Selah
                        </div>
                        <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-white/40 mt-1.5">
                            Worship Studio
                        </div>
                    </div>
                </div>

                <div className="flex-1 flex flex-col justify-center max-w-2xl">
                    <div
                        className="sw-badge inline-flex w-fit items-center gap-2 px-4 py-2 rounded-full mb-6"
                        style={{
                            background:
                                'linear-gradient(135deg, rgba(20,184,166,0.22) 0%, rgba(13,148,136,0.10) 100%)',
                            border: '1px solid rgba(20,184,166,0.45)',
                            boxShadow:
                                '0 8px 24px -8px rgba(20,184,166,0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
                        }}
                    >
                        <Sparkles className="w-3.5 h-3.5 text-primary-300" />
                        <span className="text-sm font-semibold text-primary-200">
                            {greeting.headline}
                        </span>
                    </div>

                    <h1
                        className="text-5xl xl:text-6xl font-bold leading-[1.05] text-white mb-5 font-serif tracking-tight"
                        style={{ textShadow: '0 1px 0 rgba(0,0,0,0.4)' }}
                    >
                        <span className="sw-headline-line block">
                            Every word.{' '}
                            <span
                                className="italic"
                                style={{
                                    background:
                                        'linear-gradient(135deg, #5eead4 0%, #2dd4bf 45%, #fcd34d 100%)',
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent',
                                    backgroundClip: 'text',
                                }}
                            >
                                Every verse.
                            </span>
                        </span>
                        <span className="sw-headline-line block">Every moment.</span>
                    </h1>

                    <p className="sw-sub text-base text-zinc-400 leading-relaxed max-w-md font-medium">
                        {greeting.sub}
                    </p>

                    <div
                        className="sw-mock mt-9 rounded-2xl overflow-hidden flex flex-col animate-mock-float"
                        style={{
                            height: '420px',
                            background:
                                'linear-gradient(180deg, rgba(15,18,22,0.85) 0%, rgba(8,10,14,0.95) 100%)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            boxShadow:
                                '0 40px 80px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 60px -20px rgba(20,184,166,0.15)',
                            backdropFilter: 'blur(20px)',
                        }}
                    >
                        <div
                            className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0"
                            style={{ borderColor: 'rgba(255,255,255,0.06)' }}
                        >
                            <div className="flex gap-1.5">
                                <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
                                <div className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
                            </div>
                            <div className="ml-2 flex items-center gap-2">
                                <Mic className="w-3 h-3 text-primary-400" />
                                <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-white/50">
                                    Sermon Listener
                                </span>
                            </div>
                            <span className="ml-auto flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.22em] text-emerald-400">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-live-dot" />
                                Live
                            </span>
                        </div>

                        <div className="flex-1 p-6 pb-5 flex flex-col gap-4 overflow-hidden min-h-0">
                            <div className="flex items-center gap-1 h-9 flex-shrink-0">
                                {waveBars.map((h, i) => (
                                    <div
                                        key={i}
                                        className="flex-1 rounded-full"
                                        style={{
                                            background: `linear-gradient(180deg, #2dd4bf 0%, #0d9488 100%)`,
                                            animation: `waveform-bar 1.3s ease-in-out ${i * 0.045}s infinite`,
                                            opacity: 0.7,
                                            minHeight: '4px',
                                            maxHeight: `${h}%`,
                                        }}
                                    />
                                ))}
                            </div>

                            <div className="flex-1 overflow-hidden flex flex-col justify-end gap-2 min-h-0">
                                {demoTranscript.map((line, i) => (
                                    <p
                                        key={i}
                                        className="text-sm leading-relaxed transition-all duration-500"
                                        style={{
                                            opacity: i <= transcriptIdx ? 1 : 0,
                                            color:
                                                line.isVerse && i === transcriptIdx
                                                    ? '#5eead4'
                                                    : 'rgb(228,228,231)',
                                            fontWeight:
                                                line.isVerse && i === transcriptIdx ? 600 : 400,
                                            transform:
                                                i === transcriptIdx ? 'translateX(0)' : 'translateX(0)',
                                        }}
                                    >
                                        {line.text}
                                        {line.isVerse && i <= transcriptIdx && (
                                            <span
                                                className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-widest"
                                                style={{
                                                    background: 'rgba(20,184,166,0.18)',
                                                    color: '#5eead4',
                                                }}
                                            >
                                                detected
                                            </span>
                                        )}
                                    </p>
                                ))}
                            </div>
                        </div>

                        <div className="h-[104px] flex-shrink-0 px-6 pb-6">
                            <div
                                className="h-full p-3.5 rounded-xl"
                                style={{
                                    background: 'linear-gradient(135deg, rgba(20,184,166,0.18), rgba(20,184,166,0.04))',
                                    border: '1px solid rgba(20,184,166,0.32)',
                                    boxShadow: '0 8px 24px -8px rgba(20,184,166,0.25)',
                                    opacity: showDetected ? 1 : 0,
                                    transform: showDetected ? 'translateX(0)' : 'translateX(-8px)',
                                    transition: 'opacity 0.5s ease, transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
                                }}
                            >
                                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.22em] text-primary-300 mb-1">
                                    <span
                                        className="w-1.5 h-1.5 rounded-full bg-primary-400"
                                        style={{
                                            animation: showDetected
                                                ? 'live-dot 1.6s ease-in-out infinite'
                                                : 'none',
                                        }}
                                    />
                                    Queued for display
                                </div>
                                <div className="text-white font-serif font-semibold text-lg leading-tight">
                                    John 3:16
                                </div>
                                <div className="text-xs text-zinc-400 mt-0.5 italic font-serif truncate">
                                    &ldquo;For God so loved the world…&rdquo;
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="w-full max-w-2xl mt-6 space-y-5">
                    <div className="h-px w-12 bg-white/10" />

                    <div className="sw-verses relative h-[88px] overflow-hidden">
                        {rotatingVerses.map((v, i) => (
                            <div
                                key={v.ref}
                                className="absolute inset-0 flex flex-col justify-center"
                                style={{
                                    opacity: i === verseIdx ? 1 : 0,
                                    transform:
                                        i === verseIdx
                                            ? 'translateY(0)'
                                            : i < verseIdx
                                            ? 'translateY(-10px)'
                                            : 'translateY(10px)',
                                    transition:
                                        'opacity 0.9s ease, transform 0.9s ease',
                                }}
                            >
                                <div className="flex items-start gap-2.5">
                                    <Quote className="w-4 h-4 text-primary-400/70 mt-1 flex-shrink-0" />
                                    <p className="text-[17px] text-zinc-100 font-serif italic leading-snug">
                                        {v.text}
                                    </p>
                                </div>
                                <p className="text-[10px] text-primary-400 font-mono uppercase tracking-[0.24em] mt-2.5 ml-6.5">
                                    — {v.ref}
                                </p>
                            </div>
                        ))}
                    </div>

                    <div className="sw-foot text-[10px] font-mono uppercase tracking-[0.22em] text-white/30">
                        © {new Date().getFullYear()} Selah
                    </div>
                </div>
            </div>
        </div>
    )
}

function GoogleButton({ onClick, isLoading }: { onClick: () => void; isLoading: boolean }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-xl font-semibold transition-all hover:bg-zinc-800/80 active:scale-[0.98] border border-zinc-800 shadow-sm text-white bg-zinc-900/70 backdrop-blur-sm"
        >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
        </button>
    )
}

function Divider() {
    return (
        <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-800" />
            </div>
            <div className="relative flex justify-center text-xs uppercase tracking-widest font-bold">
                <span className="px-4 bg-[#09090b] text-zinc-600">or</span>
            </div>
        </div>
    )
}

function StepIndicator({ step }: { step: SignupStep }) {
    const steps: { id: SignupStep; label: string }[] = [
        { id: 'account', label: 'Account' },
        { id: 'verify', label: 'Verify' },
        { id: 'church', label: 'Church' },
    ]
    const currentIdx = steps.findIndex((s) => s.id === step)
    return (
        <div className="flex items-center justify-center gap-2 mb-6">
            {steps.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2">
                    <div
                        className="flex items-center gap-1.5"
                    >
                        <div
                            className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-bold transition-all"
                            style={{
                                background:
                                    i <= currentIdx
                                        ? 'linear-gradient(135deg, #14b8a6, #0d9488)'
                                        : 'rgba(255,255,255,0.04)',
                                color: i <= currentIdx ? '#fff' : 'rgba(255,255,255,0.3)',
                                border:
                                    i <= currentIdx
                                        ? 'none'
                                        : '1px solid rgba(255,255,255,0.08)',
                                boxShadow:
                                    i === currentIdx
                                        ? '0 0 0 3px rgba(20,184,166,0.15)'
                                        : 'none',
                            }}
                        >
                            {i < currentIdx ? (
                                <Check className="w-3 h-3" strokeWidth={3} />
                            ) : (
                                i + 1
                            )}
                        </div>
                        <span
                            className="text-[10px] font-mono uppercase tracking-[0.18em] transition-colors"
                            style={{
                                color: i <= currentIdx ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.25)',
                            }}
                        >
                            {s.label}
                        </span>
                    </div>
                    {i < steps.length - 1 && (
                        <div
                            className="w-6 h-px"
                            style={{
                                background:
                                    i < currentIdx
                                        ? 'rgba(20,184,166,0.4)'
                                        : 'rgba(255,255,255,0.08)',
                            }}
                        />
                    )}
                </div>
            ))}
        </div>
    )
}

function SignInForm({
    email, setEmail,
    password, setPassword,
    showPassword, setShowPassword,
    isLoading,
}: {
    email: string; setEmail: (v: string) => void
    password: string; setPassword: (v: string) => void
    showPassword: boolean; setShowPassword: (v: boolean) => void
    isLoading: boolean
}) {
    const auth = useClerkAuth('signin')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        await auth.handleEmailSignIn(email, password)
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            <GoogleButton onClick={() => auth.handleGoogleSignIn()} isLoading={isLoading} />
            <Divider />
            <div>
                <label className="block text-sm font-semibold mb-2 text-zinc-300">
                    Email Address
                </label>
                <div className="relative group">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 transition-colors group-focus-within:text-primary-400" />
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="pastor@church.com"
                        required
                        className="w-full pl-11 pr-4 py-3 rounded-xl text-sm transition-all focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/10 bg-zinc-900/50 border border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
                    />
                </div>
            </div>

            <div>
                <label className="block text-sm font-semibold mb-2 text-zinc-300">
                    Password
                </label>
                <div className="relative group">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 transition-colors group-focus-within:text-primary-400" />
                    <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        className="w-full pl-11 pr-12 py-3 rounded-xl text-sm transition-all focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/10 bg-zinc-900/50 border border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
                    />
                    <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-primary-400 transition-colors"
                    >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                </div>
            </div>

            <button
                type="submit"
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold text-white text-sm transition-all hover:shadow-lg hover:-translate-y-px active:translate-y-0 disabled:opacity-50"
                style={{
                    background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                    boxShadow: '0 8px 24px -4px rgba(20,184,166,0.35), inset 0 1px 0 rgba(255,255,255,0.15)',
                }}
            >
                {isLoading ? (
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                    <>
                        Sign In to Selah
                        <ArrowRight className="w-4 h-4 ml-1" />
                    </>
                )}
            </button>
        </form>
    )
}

function SignUpAccountForm({
    fullName, setFullName,
    email, setEmail,
    password, setPassword,
    showPassword, setShowPassword,
    isLoading,
    onSignUpSuccess,
}: {
    fullName: string; setFullName: (v: string) => void
    email: string; setEmail: (v: string) => void
    password: string; setPassword: (v: string) => void
    showPassword: boolean; setShowPassword: (v: boolean) => void
    isLoading: boolean
    onSignUpSuccess: () => void
}) {
    const auth = useClerkAuth('signup')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        const result = await auth.handleEmailSignUp(fullName, email, password)
        if (result === 'verify') {
            onSignUpSuccess()
        }
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            <GoogleButton onClick={() => auth.handleGoogleSignUp()} isLoading={isLoading} />
            <Divider />

            <div>
                <label className="block text-sm font-semibold mb-2 text-zinc-300">
                    Full Name
                </label>
                <div className="relative group">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 transition-colors group-focus-within:text-primary-400" />
                    <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="John Doe"
                        required
                        className="w-full pl-11 pr-4 py-3 rounded-xl text-sm transition-all focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/10 bg-zinc-900/50 border border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
                    />
                </div>
            </div>

            <div>
                <label className="block text-sm font-semibold mb-2 text-zinc-300">
                    Email Address
                </label>
                <div className="relative group">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 transition-colors group-focus-within:text-primary-400" />
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@church.com"
                        required
                        className="w-full pl-11 pr-4 py-3 rounded-xl text-sm transition-all focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/10 bg-zinc-900/50 border border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
                    />
                </div>
            </div>

            <div>
                <label className="block text-sm font-semibold mb-2 text-zinc-300">
                    Password
                </label>
                <div className="relative group">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 transition-colors group-focus-within:text-primary-400" />
                    <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Min. 8 characters"
                        required
                        minLength={8}
                        className="w-full pl-11 pr-12 py-3 rounded-xl text-sm transition-all focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/10 bg-zinc-900/50 border border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
                    />
                    <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-primary-400 transition-colors"
                    >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                </div>
            </div>

            <button
                type="submit"
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold text-white text-sm transition-all hover:shadow-lg hover:-translate-y-px active:translate-y-0 disabled:opacity-50"
                style={{
                    background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                    boxShadow: '0 8px 24px -4px rgba(20,184,166,0.35), inset 0 1px 0 rgba(255,255,255,0.15)',
                }}
            >
                {isLoading ? (
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                    <>
                        Create Account
                        <ArrowRight className="w-4 h-4 ml-1" />
                    </>
                )}
            </button>
        </form>
    )
}

function VerifyForm({
    verificationCode,
    setVerificationCode,
    isLoading,
    onVerifySuccess,
}: {
    verificationCode: string; setVerificationCode: (v: string) => void
    isLoading: boolean
    onVerifySuccess: (clerkId: string) => void
}) {
    const auth = useClerkAuth('signup')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        const sessionId = await auth.handleVerification(verificationCode)
        if (sessionId) {
            onVerifySuccess(sessionId)
        }
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="flex justify-center">
                <input
                    type="text"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    required
                    className="w-full max-w-[280px] px-4 py-5 text-center text-4xl tracking-[0.5em] font-bold rounded-2xl transition-all focus:outline-none focus:ring-4 focus:ring-primary-500/10 focus:border-primary-500 bg-zinc-900/50 border-2 border-zinc-800 text-primary-400 placeholder:text-zinc-700"
                />
            </div>

            <button
                type="submit"
                disabled={isLoading || verificationCode.length < 6}
                className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold text-white text-sm transition-all hover:shadow-lg hover:-translate-y-px active:translate-y-0 disabled:opacity-50"
                style={{
                    background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                    boxShadow: '0 8px 24px -4px rgba(20,184,166,0.35), inset 0 1px 0 rgba(255,255,255,0.15)',
                }}
            >
                {isLoading ? (
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                    <>
                        Verify Account
                        <ArrowRight className="w-4 h-4 ml-1" />
                    </>
                )}
            </button>

            <p className="text-center text-sm text-zinc-500">
                Didn&apos;t receive the code?{' '}
                <button type="button" className="font-bold text-primary-400 hover:text-primary-300 transition-colors">
                    Resend Code
                </button>
            </p>
        </form>
    )
}

function ChurchForm({
    churchOption, setChurchOption,
    churchName, setChurchName,
    churchCode, setChurchCode,
    isLoading,
    onChurchSuccess,
}: {
    churchOption: 'create' | 'join'; setChurchOption: (v: 'create' | 'join') => void
    churchName: string; setChurchName: (v: string) => void
    churchCode: string; setChurchCode: (v: string) => void
    isLoading: boolean
    onChurchSuccess: () => void
}) {
    const auth = useClerkAuth('signup')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        try {
            if (churchOption === 'create') {
                await auth.handleCreateChurch(churchName)
            } else {
                await auth.handleJoinChurch(churchCode)
            }
            onChurchSuccess()
        } catch {
            // error handled by hook
        }
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="flex gap-2 p-1.5 rounded-2xl bg-zinc-900/50 border border-zinc-800">
                <button
                    type="button"
                    onClick={() => setChurchOption('create')}
                    className="flex-1 py-2.5 px-4 rounded-xl text-sm font-bold transition-all"
                    style={
                        churchOption === 'create'
                            ? {
                                  background: 'linear-gradient(135deg, rgba(20,184,166,0.18), rgba(13,148,136,0.12))',
                                  color: '#5eead4',
                                  boxShadow: 'inset 0 0 0 1px rgba(20,184,166,0.3)',
                              }
                            : { color: 'rgba(255,255,255,0.4)' }
                    }
                >
                    Create Church
                </button>
                <button
                    type="button"
                    onClick={() => setChurchOption('join')}
                    className="flex-1 py-2.5 px-4 rounded-xl text-sm font-bold transition-all"
                    style={
                        churchOption === 'join'
                            ? {
                                  background: 'linear-gradient(135deg, rgba(20,184,166,0.18), rgba(13,148,136,0.12))',
                                  color: '#5eead4',
                                  boxShadow: 'inset 0 0 0 1px rgba(20,184,166,0.3)',
                              }
                            : { color: 'rgba(255,255,255,0.4)' }
                    }
                >
                    Join Church
                </button>
            </div>

            {churchOption === 'create' ? (
                <div className="animate-fade-in-up">
                    <label className="block text-sm font-semibold mb-2 text-zinc-300">
                        Church Name
                    </label>
                    <div className="relative group">
                        <Church className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 transition-colors group-focus-within:text-primary-400" />
                        <input
                            type="text"
                            value={churchName}
                            onChange={(e) => setChurchName(e.target.value)}
                            placeholder="Grace Community Church"
                            required
                            className="w-full pl-11 pr-4 py-3 rounded-xl text-sm transition-all focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/10 bg-zinc-900/50 border border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
                        />
                    </div>
                </div>
            ) : (
                <div className="animate-fade-in-up">
                    <label className="block text-sm font-semibold mb-2 text-zinc-300">
                        Church Invite Code
                    </label>
                    <input
                        type="text"
                        value={churchCode}
                        onChange={(e) => setChurchCode(e.target.value.toUpperCase())}
                        placeholder="ABC-123-XYZ"
                        required
                        className="w-full px-4 py-4 text-center uppercase tracking-[0.25em] font-bold rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-zinc-900/50 border border-zinc-800 text-primary-400 placeholder:text-zinc-700"
                    />
                    <p className="mt-3 text-xs text-center text-zinc-500">
                        Obtain this code from your church administrator
                    </p>
                </div>
            )}

            <button
                type="submit"
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold text-white text-sm transition-all hover:shadow-lg hover:-translate-y-px active:translate-y-0 disabled:opacity-50"
                style={{
                    background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                    boxShadow: '0 8px 24px -4px rgba(20,184,166,0.35), inset 0 1px 0 rgba(255,255,255,0.15)',
                }}
            >
                {isLoading ? (
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                    <>
                        {churchOption === 'create' ? 'Establish Church' : 'Join Community'}
                        <ArrowRight className="w-4 h-4 ml-1" />
                    </>
                )}
            </button>

            <button
                type="button"
                onClick={onChurchSuccess}
                className="w-full text-sm font-medium text-zinc-500 hover:text-primary-400 transition-colors"
            >
                Skip setup for now
            </button>
        </form>
    )
}

function RightPanel() {
    const navigate = useNavigate()
    const [authMode, setAuthMode] = useState<AuthMode>('signin')
    const [signupStep, setSignupStep] = useState<SignupStep>('account')

    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [fullName, setFullName] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [verificationCode, setVerificationCode] = useState('')
    const [churchOption, setChurchOption] = useState<'create' | 'join'>('create')
    const [churchName, setChurchName] = useState('')
    const [churchCode, setChurchCode] = useState('')

    const auth = useClerkAuth(authMode)
    const { isLoading, error, clearError } = auth

    const switchMode = (mode: AuthMode) => {
        setAuthMode(mode)
        setSignupStep('account')
        clearError()
    }

    const handleVerifySuccess = async (sessionId: string) => {
        await auth.handleCreateUser(sessionId, fullName, email)
        setSignupStep('church')
    }

    const handleChurchSuccess = () => {
        navigate('/')
    }

    return (
        <div className="w-full max-w-md px-10 py-10">
            <div className="lg:hidden flex items-center gap-3 mb-8">
                <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg"
                    style={{ background: 'linear-gradient(135deg, #14b8a6, #0d9488)' }}
                >
                    <BookOpen className="w-5 h-5 text-white" />
                </div>
                <div>
                    <span
                        style={{ fontFamily: 'Crimson Pro, serif', fontSize: '1.35rem', fontWeight: 700 }}
                        className="text-white block leading-none"
                    >
                        Selah
                    </span>
                    <span className="text-[9px] font-mono uppercase tracking-[0.22em] text-zinc-500 mt-1 block">
                        Worship Studio
                    </span>
                </div>
            </div>

            <div className="lg:hidden mb-8">
                <h1
                    style={{ fontFamily: 'Crimson Pro, serif', fontSize: '1.75rem', fontWeight: 700, lineHeight: 1.2 }}
                    className="mb-2 text-white"
                >
                    Every word. Every verse.{' '}
                    <span className="italic" style={{ color: '#5eead4' }}>
                        Every moment.
                    </span>
                </h1>
                <p className="text-zinc-400 text-sm">
                    Church presentation software that listens and displays scripture in real
                    time.
                </p>
            </div>

            {authMode === 'signup' && <StepIndicator step={signupStep} />}

            {signupStep === 'account' && authMode === 'signin' && (
                <div className="mb-8">
                    <h2 className="text-3xl font-bold text-white mb-2 font-serif tracking-tight">
                        Welcome back
                    </h2>
                    <p className="text-zinc-400 font-medium">
                        Sign in to continue to your Selah Studio
                    </p>
                </div>
            )}

            {signupStep === 'account' && authMode === 'signup' && (
                <div className="mb-8">
                    <h2 className="text-3xl font-bold text-white mb-2 font-serif tracking-tight">
                        Create your account
                    </h2>
                    <p className="text-zinc-400 font-medium">
                        Start your journey with Selah Studio
                    </p>
                </div>
            )}

            {signupStep === 'verify' && (
                <div className="mb-8">
                    <h2 className="text-3xl font-bold text-white mb-2 font-serif tracking-tight">
                        Verify your email
                    </h2>
                    <p className="text-zinc-400 font-medium leading-relaxed">
                        We&apos;ve sent a 6-digit code to{' '}
                        <strong className="text-white">{email}</strong>
                    </p>
                </div>
            )}

            {signupStep === 'church' && (
                <div className="mb-8">
                    <h2 className="text-3xl font-bold text-white mb-2 font-serif tracking-tight">
                        Set up your church
                    </h2>
                    <p className="text-zinc-400 font-medium">
                        Create a new church profile or join an existing one
                    </p>
                </div>
            )}

            {signupStep === 'account' && (
                <div className="flex p-1 rounded-xl mb-6 bg-zinc-900/50 border border-zinc-800">
                    <button
                        onClick={() => switchMode('signin')}
                        className="flex-1 py-2.5 text-sm font-bold rounded-lg transition-all"
                        style={
                            authMode === 'signin'
                                ? {
                                      background: 'linear-gradient(135deg, rgba(20,184,166,0.18), rgba(13,148,136,0.12))',
                                      color: '#5eead4',
                                      boxShadow: 'inset 0 0 0 1px rgba(20,184,166,0.3)',
                                  }
                                : { color: 'rgba(255,255,255,0.4)' }
                        }
                    >
                        Sign In
                    </button>
                    <button
                        onClick={() => switchMode('signup')}
                        className="flex-1 py-2.5 text-sm font-bold rounded-lg transition-all"
                        style={
                            authMode === 'signup'
                                ? {
                                      background: 'linear-gradient(135deg, rgba(20,184,166,0.18), rgba(13,148,136,0.12))',
                                      color: '#5eead4',
                                      boxShadow: 'inset 0 0 0 1px rgba(20,184,166,0.3)',
                                  }
                                : { color: 'rgba(255,255,255,0.4)' }
                        }
                    >
                        Sign Up
                    </button>
                </div>
            )}

            {error && (
                <div
                    className="mb-4 p-3 rounded-xl text-sm"
                    style={{
                        background: 'rgba(239,68,68,0.08)',
                        border: '1px solid rgba(239,68,68,0.2)',
                        color: '#fca5a5',
                    }}
                >
                    {error}
                </div>
            )}

            {authMode === 'signin' && signupStep === 'account' && (
                <SignInForm
                    email={email}
                    setEmail={setEmail}
                    password={password}
                    setPassword={setPassword}
                    showPassword={showPassword}
                    setShowPassword={setShowPassword}
                    isLoading={isLoading}
                />
            )}

            {authMode === 'signup' && signupStep === 'account' && (
                <SignUpAccountForm
                    fullName={fullName}
                    setFullName={setFullName}
                    email={email}
                    setEmail={setEmail}
                    password={password}
                    setPassword={setPassword}
                    showPassword={showPassword}
                    setShowPassword={setShowPassword}
                    isLoading={isLoading}
                    onSignUpSuccess={() => setSignupStep('verify')}
                />
            )}

            {signupStep === 'verify' && (
                <VerifyForm
                    verificationCode={verificationCode}
                    setVerificationCode={setVerificationCode}
                    isLoading={isLoading}
                    onVerifySuccess={(clerkId) => handleVerifySuccess(clerkId)}
                />
            )}

            {signupStep === 'church' && (
                <ChurchForm
                    churchOption={churchOption}
                    setChurchOption={setChurchOption}
                    churchName={churchName}
                    setChurchName={setChurchName}
                    churchCode={churchCode}
                    setChurchCode={setChurchCode}
                    isLoading={isLoading}
                    onChurchSuccess={handleChurchSuccess}
                />
            )}

            <div className="mt-10 pt-8 border-t border-zinc-800/60 text-center">
                <p className="text-xs text-zinc-500 flex items-center justify-center gap-2">
                    <Lock className="w-3 h-3" />
                    Secure, offline-first, and private scripture processing
                </p>
            </div>
        </div>
    )
}

export default function DesktopWelcome() {
    return (
        <div className="dark min-h-screen flex selection:bg-primary-500/30 bg-[#09090b]">
            <LeftPanel />
            <div className="flex-1 flex items-center justify-center overflow-y-auto relative">
                <div
                    className="absolute inset-0 pointer-events-none opacity-50"
                    style={{
                        background:
                            'radial-gradient(ellipse 60% 80% at 50% 50%, rgba(20,184,166,0.04), transparent 70%)',
                    }}
                />
                <div className="relative z-10 w-full flex items-center justify-center">
                    <RightPanel />
                </div>
            </div>
        </div>
    )
}
