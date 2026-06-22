import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Eye,
    EyeOff,
    Mail,
    Lock,
    User,
    ArrowRight,
    Church,
    BookOpen,
} from 'lucide-react'
import { gsap } from '@/lib/gsap'
import { WelcomeScene } from '@/components/landing/WelcomeScene'
import { Magnetic } from '@/components/landing/Magnetic'
import { useClerkAuth } from '../hooks/useClerkAuth'
import type { AuthMode } from '../hooks/useClerkAuth'

type SignupStep = 'account' | 'verify' | 'church'

// A small, curated set of beloved scriptures. Kept inline (not loaded from
// the 6.7 MB kjv.json) so the verse is instant, fully offline, and adds no
// bundle weight — matching the app's offline-first ethos. Rotated by
// VerseOfTheMoment on each mount + every ~20s.
const VERSES: { text: string; ref: string }[] = [
    { text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.', ref: 'John 3:16' },
    { text: 'The Lord is my shepherd; I shall not want. He maketh me to lie down in green pastures: he leadeth me beside the still waters.', ref: 'Psalm 23:1–2' },
    { text: 'I can do all things through Christ which strengtheneth me.', ref: 'Philippians 4:13' },
    { text: 'And we know that all things work together for good to them that love God, to them who are the called according to his purpose.', ref: 'Romans 8:28' },
    { text: 'Trust in the Lord with all thine heart; and lean not unto thine own understanding. In all thy ways acknowledge him, and he shall direct thy paths.', ref: 'Proverbs 3:5–6' },
    { text: 'Be still, and know that I am God.', ref: 'Psalm 46:10' },
    { text: 'The Lord is my light and my salvation; whom shall I fear? the Lord is the strength of my life; of whom shall I be afraid?', ref: 'Psalm 27:1' },
    { text: 'Come unto me, all ye that labour and are heavy laden, and I will give you rest.', ref: 'Matthew 11:28' },
    { text: 'For I know the thoughts that I think toward you, saith the Lord, thoughts of peace, and not of evil, to give you an expected end.', ref: 'Jeremiah 29:11' },
    { text: 'But they that wait upon the Lord shall renew their strength; they shall mount up with wings as eagles.', ref: 'Isaiah 40:31' },
    { text: 'Let the words of my mouth, and the meditation of my heart, be acceptable in thy sight, O Lord, my strength, and my redeemer.', ref: 'Psalm 19:14' },
    { text: 'Now faith is the substance of things hoped for, the evidence of things not seen.', ref: 'Hebrews 11:1' },
    { text: 'Thy word is a lamp unto my feet, and a light unto my path.', ref: 'Psalm 119:105' },
    { text: 'Create in me a clean heart, O God; and renew a right spirit within me.', ref: 'Psalm 51:10' },
    { text: 'He hath shewed thee, O man, what is good; and what doth the Lord require of thee, but to do justly, and to love mercy, and to walk humbly with thy God?', ref: 'Micah 6:8' },
    { text: 'The grass withereth, the flower fadeth: but the word of our God shall stand for ever.', ref: 'Isaiah 40:8' },
]

// ─────────────────────────────────────────────────────────────────────────────
// Atmosphere panel pieces
// ─────────────────────────────────────────────────────────────────────────────

function splitChars(el: HTMLElement) {
    const text = el.textContent ?? ''
    el.setAttribute('aria-label', text)
    el.innerHTML = text
        .split('')
        .map((c) =>
            c === ' '
                ? '<span class="welcome-char inline-block will-change-transform" aria-hidden="true">&nbsp;</span>'
                : `<span class="welcome-char inline-block will-change-transform" aria-hidden="true">${c}</span>`
        )
        .join('')
}

function VerseOfTheMoment() {
    const textRef = useRef<HTMLParagraphElement>(null)
    const refRef = useRef<HTMLParagraphElement>(null)
    const indexRef = useRef(Math.floor(Math.random() * VERSES.length))

    useEffect(() => {
        let mounted = true
        const swap = (next: number) => {
            if (!mounted || !textRef.current || !refRef.current) return
            const v = VERSES[next]
            gsap.to([textRef.current, refRef.current], {
                opacity: 0,
                y: -8,
                duration: 0.6,
                ease: 'power2.in',
                onComplete: () => {
                    if (!mounted || !textRef.current || !refRef.current) return
                    textRef.current.textContent = `“${v.text}”`
                    refRef.current.textContent = v.ref
                    gsap.fromTo(
                        [textRef.current, refRef.current],
                        { opacity: 0, y: 10 },
                        { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out', stagger: 0.08 }
                    )
                },
            })
        }

        const interval = window.setInterval(() => {
            indexRef.current = (indexRef.current + 1 + Math.floor(Math.random() * (VERSES.length - 1))) % VERSES.length
            swap(indexRef.current)
        }, 20000)

        return () => {
            mounted = false
            window.clearInterval(interval)
        }
    }, [])

    const initial = VERSES[indexRef.current]

    return (
        <div className="relative max-w-2xl">
            {/* Oversized decorative quotemark anchoring the verse */}
            <span
                aria-hidden
                className="welcome-quote-mark absolute -top-16 -left-6 select-none pointer-events-none"
                style={{
                    fontFamily: 'Crimson Pro, Georgia, serif',
                    fontSize: '11rem',
                    lineHeight: 1,
                    color: 'rgba(20,184,166,0.12)',
                }}
            >
                &ldquo;
            </span>
            <p
                ref={textRef}
                className="relative text-3xl xl:text-[2.6rem] leading-[1.25] text-zinc-100"
                style={{ fontFamily: 'Crimson Pro, Georgia, serif', fontStyle: 'italic', fontWeight: 500 }}
            >
                {initial.text}
            </p>
            <p
                ref={refRef}
                className="relative mt-6 text-xs font-mono uppercase tracking-[0.3em] text-teal-300/80"
            >
                {initial.ref}
            </p>
        </div>
    )
}

function LiveClock() {
    const [now, setNow] = useState(() => new Date())
    useEffect(() => {
        const id = window.setInterval(() => setNow(new Date()), 15000)
        return () => window.clearInterval(id)
    }, [])

    const day = now.toLocaleDateString(undefined, { weekday: 'long' })
    const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

    return (
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.22em] text-zinc-500">
            <span className="w-1 h-1 rounded-full bg-teal-400/80" />
            {day} · {time}
        </div>
    )
}

function LeftPanel() {
    const wordmarkRef = useRef<HTMLHeadingElement>(null)

    useEffect(() => {
        if (!wordmarkRef.current) return
        splitChars(wordmarkRef.current)

        const animatedSelectors = [
            '.welcome-char',
            '.welcome-tag',
            '.welcome-quote-mark',
            '.welcome-verse',
            '.welcome-clock',
        ]

        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        if (reduced) {
            gsap.set(animatedSelectors.join(','), { opacity: 1, clearProps: 'transform' })
            return
        }

        const tl = gsap.timeline()
        tl.from('.welcome-char', {
            yPercent: 120,
            rotateX: -80,
            opacity: 0,
            duration: 0.9,
            ease: 'power4.out',
            stagger: { each: 0.03, from: 'start' },
        })
            .from('.welcome-tag', { opacity: 0, y: 12, duration: 0.7, ease: 'power3' }, '-=0.4')
            .from('.welcome-quote-mark', { opacity: 0, scale: 0.8, duration: 1, ease: 'power3.out' }, '-=0.7')
            .from('.welcome-verse', { opacity: 0, y: 20, duration: 0.9, ease: 'power3' }, '-=0.6')
            .from('.welcome-clock', { opacity: 0, duration: 0.8, ease: 'power2' }, '-=0.5')

        // Safety net: if the timeline is killed before completion (e.g. React
        // StrictMode double-mount, component remount, etc.) the .from() tweens
        // leave elements stuck at opacity 0. Force the final visible state.
        const safety = window.setTimeout(() => {
            gsap.set(animatedSelectors.join(','), { opacity: 1, clearProps: 'y,yPercent,scale,rotateX,transform' })
        }, 2500)

        return () => {
            tl.kill()
            window.clearTimeout(safety)
        }
    }, [])

    return (
        <div
            className="hidden lg:flex lg:w-[58%] xl:w-[62%] relative flex-col justify-between overflow-hidden"
            style={{ background: '#08090c' }}
        >
            {/* Ambient gradient base — also the graceful fallback if WebGL is unavailable */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    background:
                        'radial-gradient(ellipse 60% 55% at 28% 18%, rgba(20,184,166,0.18), transparent 62%),' +
                        'radial-gradient(ellipse 50% 50% at 78% 82%, rgba(217,119,6,0.09), transparent 65%)',
                }}
            />
            <WelcomeScene />

            {/* Subtle grid for depth */}
            <div
                className="absolute inset-0 pointer-events-none opacity-[0.05]"
                style={{
                    backgroundImage:
                        'linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)',
                    backgroundSize: '64px 64px',
                    maskImage: 'radial-gradient(ellipse 65% 60% at 42% 48%, black 22%, transparent 82%)',
                    WebkitMaskImage: 'radial-gradient(ellipse 65% 60% at 42% 48%, black 22%, transparent 82%)',
                }}
            />

            {/* Wordmark — top */}
            <div className="relative z-10 px-14 xl:px-20 pt-14">
                <div className="flex items-center gap-4">
                    <div
                        className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-2xl"
                        style={{
                            background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                            boxShadow: '0 8px 32px -4px rgba(20,184,166,0.4), inset 0 1px 0 rgba(255,255,255,0.2)',
                        }}
                    >
                        <BookOpen className="w-5 h-5 text-white" />
                    </div>
                    <h1
                        ref={wordmarkRef}
                        className="text-4xl font-bold tracking-tight text-white"
                        style={{ fontFamily: 'Crimson Pro, serif', fontWeight: 600, perspective: '600px' }}
                    >
                        Selah
                    </h1>
                </div>
                <p className="welcome-tag mt-3 text-xs font-mono uppercase tracking-[0.3em] text-zinc-500">
                    pause &middot; reflect
                </p>
            </div>

            {/* Large verse-of-the-moment — the centerpiece */}
            <div className="relative z-10 px-14 xl:px-20 flex-1 flex flex-col justify-center -mt-6">
                <div className="welcome-verse" style={{ opacity: 1 }}>
                    <VerseOfTheMoment />
                </div>
            </div>

            {/* Clock + footer */}
            <div className="relative z-10 px-14 xl:px-20 pb-12 flex items-end justify-between gap-6">
                <div className="welcome-clock" style={{ opacity: 1 }}>
                    <LiveClock />
                </div>
                <p className="text-zinc-600 text-[10px] font-mono uppercase tracking-[0.25em]">
                    &copy; {new Date().getFullYear()} Selah
                </p>
            </div>
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth — preserved logic, refined styling
// ─────────────────────────────────────────────────────────────────────────────

function GoogleButton({ onClick, isLoading }: { onClick: () => void; isLoading: boolean }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-xl font-semibold transition-all hover:bg-zinc-800 active:scale-[0.98] border border-zinc-800 shadow-sm text-white bg-zinc-900"
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
                <span className="px-4 bg-[#0e0f13] text-zinc-600">or</span>
            </div>
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
        const success = await auth.handleEmailSignIn(email, password)
        if (success) {
            // navigation handled by Clerk + Convex
        }
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
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 transition-colors group-focus-within:text-teal-400" />
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="pastor@church.com"
                        required
                        className="w-full pl-11 pr-4 py-3 rounded-xl text-sm transition-all focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 bg-zinc-900/50 border border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
                    />
                </div>
            </div>

            <div>
                <label className="block text-sm font-semibold mb-2 text-zinc-300">
                    Password
                </label>
                <div className="relative group">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 transition-colors group-focus-within:text-teal-400" />
                    <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        className="w-full pl-11 pr-12 py-3 rounded-xl text-sm transition-all focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 bg-zinc-900/50 border border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-teal-400 transition-colors">
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                </div>
            </div>

            <Magnetic strength={0.2}>
                <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold text-white text-sm transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #14b8a6, #0d9488)', boxShadow: '0 8px 24px -4px rgba(20,184,166,0.4), inset 0 1px 0 rgba(255,255,255,0.15)' }}>
                    {isLoading ? (
                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                        <>
                            Continue
                            <ArrowRight className="w-4 h-4 ml-1" />
                        </>
                    )}
                </button>
            </Magnetic>
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
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 transition-colors group-focus-within:text-teal-400" />
                    <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="John Doe"
                        required
                        className="w-full pl-11 pr-4 py-3 rounded-xl text-sm transition-all focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 bg-zinc-900/50 border border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
                    />
                </div>
            </div>

            <div>
                <label className="block text-sm font-semibold mb-2 text-zinc-300">
                    Email Address
                </label>
                <div className="relative group">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 transition-colors group-focus-within:text-teal-400" />
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@church.com"
                        required
                        className="w-full pl-11 pr-4 py-3 rounded-xl text-sm transition-all focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 bg-zinc-900/50 border border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
                    />
                </div>
            </div>

            <div>
                <label className="block text-sm font-semibold mb-2 text-zinc-300">
                    Password
                </label>
                <div className="relative group">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 transition-colors group-focus-within:text-teal-400" />
                    <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Min. 8 characters"
                        required
                        minLength={8}
                        className="w-full pl-11 pr-12 py-3 rounded-xl text-sm transition-all focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 bg-zinc-900/50 border border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-teal-400 transition-colors">
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                </div>
            </div>

            <Magnetic strength={0.2}>
                <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold text-white text-sm transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #14b8a6, #0d9488)', boxShadow: '0 8px 24px -4px rgba(20,184,166,0.4), inset 0 1px 0 rgba(255,255,255,0.15)' }}>
                    {isLoading ? (
                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                        <>
                            Create Account
                            <ArrowRight className="w-4 h-4 ml-1" />
                        </>
                    )}
                </button>
            </Magnetic>
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
                    className="w-full max-w-[280px] px-4 py-5 text-center text-4xl tracking-[0.5em] font-bold rounded-2xl transition-all focus:outline-none focus:ring-4 focus:ring-teal-500/15 focus:border-teal-500 bg-zinc-900/60 border-2 border-zinc-800 text-teal-300 placeholder:opacity-20"
                />
            </div>

            <Magnetic strength={0.2}>
                <button
                    type="submit"
                    disabled={isLoading || verificationCode.length < 6}
                    className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl font-bold text-white text-sm transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #14b8a6, #0d9488)', boxShadow: '0 8px 24px -4px rgba(20,184,166,0.4), inset 0 1px 0 rgba(255,255,255,0.15)' }}>
                    {isLoading ? (
                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                        <>
                            Verify Account
                            <ArrowRight className="w-4 h-4 ml-1" />
                        </>
                    )}
                </button>
            </Magnetic>

            <p className="text-center text-sm text-zinc-500">
                Didn&apos;t receive the code?{' '}
                <button type="button" className="font-bold text-teal-400 hover:underline">
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
            <div className="flex gap-2 p-1.5 rounded-2xl bg-zinc-900/60 border border-zinc-800">
                <button type="button" onClick={() => setChurchOption('create')}
                    className="flex-1 py-2.5 px-4 rounded-xl text-sm font-bold transition-all"
                    style={churchOption === 'create'
                        ? { background: '#1c1917', color: '#fafaf9', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }
                        : { color: '#71717a' }}>
                    Create Church
                </button>
                <button type="button" onClick={() => setChurchOption('join')}
                    className="flex-1 py-2.5 px-4 rounded-xl text-sm font-bold transition-all"
                    style={churchOption === 'join'
                        ? { background: '#1c1917', color: '#fafaf9', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }
                        : { color: '#71717a' }}>
                    Join Church
                </button>
            </div>

            {churchOption === 'create' ? (
                <div className="animate-fade-in-up">
                    <label className="block text-sm font-semibold mb-2 text-zinc-300">
                        Church Name
                    </label>
                    <div className="relative group">
                        <Church className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 transition-colors group-focus-within:text-teal-400" />
                        <input
                            type="text"
                            value={churchName}
                            onChange={(e) => setChurchName(e.target.value)}
                            placeholder="Grace Community Church"
                            required
                            className="w-full pl-11 pr-4 py-3 rounded-xl text-sm transition-all focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 bg-zinc-900/50 border border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
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
                        className="w-full px-4 py-4 text-center uppercase tracking-[0.25em] font-bold rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-zinc-900/60 border border-zinc-800 text-teal-300"
                    />
                    <p className="mt-3 text-xs text-center text-zinc-500">
                        Obtain this code from your church administrator
                    </p>
                </div>
            )}

            <Magnetic strength={0.2}>
                <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl font-bold text-white text-sm transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #14b8a6, #0d9488)', boxShadow: '0 8px 24px -4px rgba(20,184,166,0.4), inset 0 1px 0 rgba(255,255,255,0.15)' }}>
                    {isLoading ? (
                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                        <>
                            {churchOption === 'create' ? 'Establish Church' : 'Join Community'}
                            <ArrowRight className="w-4 h-4 ml-1" />
                        </>
                    )}
                </button>
            </Magnetic>

            <button type="button" onClick={onChurchSuccess}
                className="w-full text-sm font-medium text-zinc-500 hover:text-teal-400 transition-colors">
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
        <div className="w-full max-w-[26rem] px-8 xl:px-12 py-12">
            {/* Logo for mobile / narrow screens */}
            <div className="lg:hidden flex items-center gap-2.5 mb-8">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg"
                    style={{ background: 'linear-gradient(135deg, #14b8a6, #0d9488)' }}>
                    <BookOpen className="w-5 h-5 text-white" />
                </div>
                <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '1.35rem', fontWeight: 700, color: '#fafaf9' }}>
                    Selah
                </span>
            </div>

            {/* Mobile-only tagline */}
            <div className="lg:hidden mb-8">
                <h1 style={{ fontFamily: 'Crimson Pro, serif', fontSize: '1.75rem', fontWeight: 700, lineHeight: 1.2, color: '#fafaf9' }}
                    className="mb-2">
                    pause &middot; reflect
                </h1>
                <p style={{ color: '#a8a29e', fontSize: '0.9rem' }}>
                    Welcome back to your worship studio.
                </p>
            </div>

            {/* Header text based on current step */}
            {signupStep === 'account' && authMode === 'signin' && (
                <div className="mb-8">
                    <h2 className="text-3xl font-bold text-zinc-100 mb-2 font-serif tracking-tight">
                        Welcome back
                    </h2>
                    <p className="text-zinc-400 font-medium">
                        Sign in to continue to your studio
                    </p>
                </div>
            )}

            {signupStep === 'account' && authMode === 'signup' && (
                <div className="mb-8">
                    <h2 className="text-3xl font-bold text-zinc-100 mb-2 font-serif tracking-tight">
                        Create your account
                    </h2>
                    <p className="text-zinc-400 font-medium">
                        Start your journey with Selah
                    </p>
                </div>
            )}

            {signupStep === 'verify' && (
                <div className="mb-8">
                    <h2 className="text-3xl font-bold text-zinc-100 mb-2 font-serif tracking-tight">
                        Verify your email
                    </h2>
                    <p className="text-zinc-400 font-medium leading-relaxed">
                        We&rsquo;ve sent a 6-digit code to <strong className="text-zinc-100">{email}</strong>
                    </p>
                </div>
            )}

            {signupStep === 'church' && (
                <div className="mb-8">
                    <h2 className="text-3xl font-bold text-zinc-100 mb-2 font-serif tracking-tight">
                        Set up your church
                    </h2>
                    <p className="text-zinc-400 font-medium">
                        Create a new church profile or join an existing one
                    </p>
                </div>
            )}

            {/* Auth mode toggle — only on account step */}
            {signupStep === 'account' && (
                <div className="flex p-1 rounded-xl mb-6 bg-zinc-900/60 border border-zinc-800">
                    <button
                        onClick={() => switchMode('signin')}
                        className="flex-1 py-2.5 text-sm font-medium rounded-lg transition-all"
                        style={authMode === 'signin'
                            ? { background: '#1c1917', color: '#fafaf9', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }
                            : { color: '#71717a' }}>
                        Sign In
                    </button>
                    <button
                        onClick={() => switchMode('signup')}
                        className="flex-1 py-2.5 text-sm font-medium rounded-lg transition-all"
                        style={authMode === 'signup'
                            ? { background: '#1c1917', color: '#fafaf9', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }
                            : { color: '#71717a' }}>
                        Sign Up
                    </button>
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="mb-4 p-3 rounded-xl text-sm"
                    style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
                    {error}
                </div>
            )}

            {/* Sign In Form */}
            {authMode === 'signin' && signupStep === 'account' && (
                <SignInForm
                    email={email} setEmail={setEmail}
                    password={password} setPassword={setPassword}
                    showPassword={showPassword} setShowPassword={setShowPassword}
                    isLoading={isLoading}
                />
            )}

            {/* Sign Up Account Form */}
            {authMode === 'signup' && signupStep === 'account' && (
                <SignUpAccountForm
                    fullName={fullName} setFullName={setFullName}
                    email={email} setEmail={setEmail}
                    password={password} setPassword={setPassword}
                    showPassword={showPassword} setShowPassword={setShowPassword}
                    isLoading={isLoading}
                    onSignUpSuccess={() => setSignupStep('verify')}
                />
            )}

            {/* Verify Step */}
            {signupStep === 'verify' && (
                <VerifyForm
                    verificationCode={verificationCode}
                    setVerificationCode={setVerificationCode}
                    isLoading={isLoading}
                    onVerifySuccess={(clerkId) => handleVerifySuccess(clerkId)}
                />
            )}

            {/* Church Step */}
            {signupStep === 'church' && (
                <ChurchForm
                    churchOption={churchOption} setChurchOption={setChurchOption}
                    churchName={churchName} setChurchName={setChurchName}
                    churchCode={churchCode} setChurchCode={setChurchCode}
                    isLoading={isLoading}
                    onChurchSuccess={handleChurchSuccess}
                />
            )}

            {/* Footer */}
            <div className="mt-12 pt-8 border-t border-zinc-800 text-center">
                <p className="text-xs text-zinc-500 flex items-center justify-center gap-2">
                    <Lock className="w-3 h-3" />
                    Secure &middot; offline-first &middot; private
                </p>
            </div>
        </div>
    )
}

export default function DesktopWelcome() {
    return (
        <div className="dark min-h-screen flex selection:bg-teal-500/30" style={{ background: '#08090c' }}>
            <LeftPanel />
            <div className="flex-1 flex items-center justify-center overflow-y-auto relative">
                <RightPanel />
            </div>
        </div>
    )
}
