import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Music,
    Eye,
    EyeOff,
    Mail,
    Lock,
    User,
    ArrowRight,
    Mic,
    WifiOff,
    Monitor,
    LayoutDashboard,
    Church,
    Search,
    BookOpen,
} from 'lucide-react'
import { useClerkAuth } from '../hooks/useClerkAuth'
import type { AuthMode } from '../hooks/useClerkAuth'

const benefits = [
    {
        icon: Mic,
        title: 'Sermon Whisper AI',
        description: 'Real-time AI transcription and scripture detection that follows the preacher automatically.',
    },
    {
        icon: Monitor,
        title: 'Studio Production Suite',
        description: 'Professional multi-screen engine for immersive worship experiences and projection.',
    },
    {
        icon: Search,
        title: 'Semantic Verse Engine',
        description: 'Search the Word by meaning, not just keywords. Instant access to the entire Bible.',
    },
    {
        icon: WifiOff,
        title: 'Offline Fortress',
        description: 'Keeps running even when the church wifi drops. 100% offline scripture engine.',
    },
]

type SignupStep = 'account' | 'verify' | 'church'

function LeftPanel() {
    return (
        <div className="hidden lg:flex lg:w-[50%] xl:w-[55%] relative flex-col justify-between overflow-hidden bg-primary-950">
            {/* Background Image with Enhanced Overlay */}
            <div className="absolute inset-0 z-0 overflow-hidden">
                <img
                    src="/Users/danielabakah/.gemini/antigravity/brain/90d0d5bc-43a0-4ae6-9c19-d8f3a8e473ae/selah_hero_visual_1777286567421.png"
                    alt="Selah Hero"
                    className="w-full h-full object-cover scale-105"
                />
                {/* Lighter, more vibrant gradient overlay to reveal the image */}
                <div className="absolute inset-0 bg-gradient-to-tr from-primary-950/90 via-primary-950/60 to-primary-950/10" />
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary-950/5 to-primary-950/80" />
            </div>

            {/* Grain Overlay - Moved here */}
            <div className="absolute inset-0 pointer-events-none z-1 opacity-20 grain-overlay" />

            {/* Grid Pattern Reintegrated */}
            <div className="absolute inset-0 z-1 pointer-events-none opacity-20"
                style={{
                    backgroundImage: 'linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)',
                    backgroundSize: '48px 48px',
                }} />

            {/* Grain Overlay */}
            <div className="grain-overlay opacity-30" />

            <div className="relative z-10 flex-1 flex flex-col justify-center px-16 xl:px-24 py-12">
                <div className="mb-14 animate-fade-in-up">
                    <div className="flex items-center gap-4 mb-10">
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-2xl"
                            style={{ background: 'linear-gradient(135deg, var(--color-primary-500), var(--color-primary-700))' }}>
                            <BookOpen className="w-6 h-6 text-white" />
                        </div>
                        <span className="text-2xl font-bold tracking-tight text-white font-serif">
                            Selah
                        </span>
                    </div>
                    <h1 className="text-5xl xl:text-6xl font-bold leading-[1.1] text-white mb-6 font-serif tracking-tight">
                        Every word.<br />
                        Every verse.<br />
                        <span className="text-primary-400 italic">Every moment.</span>
                    </h1>
                    <p className="text-lg text-zinc-300 leading-relaxed max-w-md font-medium">
                        The ultimate AI-powered operating system for the modern Church. Seamlessly bridge the gap between spoken word and sacred scripture.
                    </p>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 animate-fade-in-up animation-delay-200">
                    {benefits.map((b) => (
                        <div key={b.title}
                            className="group p-6 rounded-2xl transition-all duration-300 hover:scale-[1.02] hover:bg-white/[0.05]"
                            style={{
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                backdropFilter: 'blur(12px)'
                            }}>
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 transition-all group-hover:bg-primary-500/30 bg-white/5 shadow-inner">
                                <b.icon className="w-5 h-5 text-primary-300" />
                            </div>
                            <h3 className="text-white font-bold mb-2 text-base tracking-wide">{b.title}</h3>
                            <p className="text-zinc-400 text-sm leading-relaxed font-medium">{b.description}</p>
                        </div>
                    ))}
                </div>
            </div>

            <div className="relative z-10 px-16 xl:px-24 pb-10 flex items-center justify-between">
                <p className="text-white/30 text-xs font-medium tracking-widest uppercase">
                    &copy; {new Date().getFullYear()} Selah Studio &bull; Built for the Church
                </p>
                <div className="flex gap-6">
                    <div className="w-1 h-1 rounded-full bg-white/20" />
                    <div className="w-1 h-1 rounded-full bg-white/20" />
                    <div className="w-1 h-1 rounded-full bg-white/20" />
                </div>
            </div>
        </div>
    )
}

function GoogleButton({ onClick, isLoading }: { onClick: () => void; isLoading: boolean }) {
    return (
        <button
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
                <span className="px-4 bg-[#09090b] text-zinc-600">or</span>
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
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 transition-colors group-focus-within:text-primary-400" />
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="pastor@church.com"
                        required
                        className="w-full pl-11 pr-4 py-3 rounded-xl text-sm transition-all focus:outline-none focus:border-primary-500 bg-zinc-900/50 border border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
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
                        className="w-full pl-11 pr-12 py-3 rounded-xl text-sm transition-all focus:outline-none focus:border-primary-500 bg-zinc-900/50 border border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-primary-500 transition-colors">
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                </div>
            </div>

            <button
                type="submit"
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold text-white text-sm transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--color-primary-600), var(--color-primary-700))', boxShadow: '0 8px 24px rgba(13,148,136,0.2)' }}>
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
                        className="w-full pl-11 pr-4 py-3 rounded-xl text-sm transition-all focus:outline-none focus:border-primary-500 bg-zinc-900/50 border border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
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
                        className="w-full pl-11 pr-4 py-3 rounded-xl text-sm transition-all focus:outline-none focus:border-primary-500 bg-zinc-900/50 border border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
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
                        className="w-full pl-11 pr-12 py-3 rounded-xl text-sm transition-all focus:outline-none focus:border-primary-500 bg-zinc-900/50 border border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-primary-500 transition-colors">
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                </div>
            </div>

            <button
                type="submit"
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold text-white text-sm transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--color-primary-600), var(--color-primary-700))', boxShadow: '0 8px 24px rgba(13,148,136,0.2)' }}>
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
                    className="w-full max-w-[280px] px-4 py-5 text-center text-4xl tracking-[0.5em] font-bold rounded-2xl transition-all focus:outline-none focus:ring-4 focus:ring-primary-500/10 focus:border-primary-500 bg-secondary border-2 border-default text-primary placeholder:opacity-20"
                />
            </div>

            <button
                type="submit"
                disabled={isLoading || verificationCode.length < 6}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl font-bold text-white text-sm transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--color-primary-600), var(--color-primary-700))', boxShadow: '0 8px 24px rgba(13,148,136,0.2)' }}>
                {isLoading ? (
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                    <>
                        Verify Account
                        <ArrowRight className="w-4 h-4 ml-1" />
                    </>
                )}
            </button>

            <p className="text-center text-sm text-muted">
                Didn&apos;t receive the code?{' '}
                <button type="button" className="font-bold text-primary-500 hover:underline">
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
            <div className="flex gap-2 p-1.5 rounded-2xl bg-tertiary border border-default/50">
                <button type="button" onClick={() => setChurchOption('create')}
                    className="flex-1 py-2.5 px-4 rounded-xl text-sm font-bold transition-all"
                    style={churchOption === 'create'
                        ? { background: 'var(--bg-card)', color: 'var(--text-primary)', boxShadow: 'var(--shadow-sm)' }
                        : { color: 'var(--text-muted)' }}>
                    Create Church
                </button>
                <button type="button" onClick={() => setChurchOption('join')}
                    className="flex-1 py-2.5 px-4 rounded-xl text-sm font-bold transition-all"
                    style={churchOption === 'join'
                        ? { background: 'var(--bg-card)', color: 'var(--text-primary)', boxShadow: 'var(--shadow-sm)' }
                        : { color: 'var(--text-muted)' }}>
                    Join Church
                </button>
            </div>

            {churchOption === 'create' ? (
                <div className="animate-fade-in-up">
                    <label className="block text-sm font-semibold mb-2 text-zinc-300">
                        Church Name
                    </label>
                    <div className="relative group">
                        <Church className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted transition-colors group-focus-within:text-primary-500" />
                        <input
                            type="text"
                            value={churchName}
                            onChange={(e) => setChurchName(e.target.value)}
                            placeholder="Grace Community Church"
                            required
                            className="w-full pl-11 pr-4 py-3 rounded-xl text-sm transition-all focus:outline-none focus:border-primary-500 bg-zinc-900/50 border border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
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
                        className="w-full px-4 py-4 text-center uppercase tracking-[0.25em] font-bold rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-secondary border-default text-primary"
                    />
                    <p className="mt-3 text-xs text-center text-muted">
                        Obtain this code from your church administrator
                    </p>
                </div>
            )}

            <button
                type="submit"
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl font-bold text-white text-sm transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--color-primary-600), var(--color-primary-700))', boxShadow: '0 8px 24px rgba(13,148,136,0.2)' }}>
                {isLoading ? (
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                    <>
                        {churchOption === 'create' ? 'Establish Church' : 'Join Community'}
                        <ArrowRight className="w-4 h-4 ml-1" />
                    </>
                )}
            </button>

            <button type="button" onClick={onChurchSuccess}
                className="w-full text-sm font-medium text-muted hover:text-primary transition-colors">
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
        <div className="w-full max-w-md px-10 py-12">
                {/* Logo for mobile / narrow screens */}
                <div className="lg:hidden flex items-center gap-2.5 mb-8">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg"
                        style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)' }}>
                        <BookOpen className="w-5 h-5 text-white" />
                    </div>
                    <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        Selah
                    </span>
                </div>

                {/* Mobile-only tagline */}
                <div className="lg:hidden mb-8">
                    <h1 style={{ fontFamily: 'Crimson Pro, serif', fontSize: '1.75rem', fontWeight: 700, lineHeight: 1.2, color: 'var(--text-primary)' }}
                        className="mb-2">
                        Every word. Every verse.{' '}
                        <span style={{ color: '#0d9488' }}>Every moment.</span>
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                        Church presentation software that listens and displays scripture in real time.
                    </p>
                </div>

                {/* Header text based on current step */}
                {signupStep === 'account' && authMode === 'signin' && (
                    <div className="mb-8">
                        <h2 className="text-3xl font-bold text-zinc-100 mb-2 font-serif tracking-tight">
                            Welcome back
                        </h2>
                        <p className="text-zinc-400 font-medium">
                            Sign in to continue to your Selah Studio
                        </p>
                    </div>
                )}

                {signupStep === 'account' && authMode === 'signup' && (
                    <div className="mb-8">
                        <h2 className="text-3xl font-bold text-zinc-100 mb-2 font-serif tracking-tight">
                            Create your account
                        </h2>
                        <p className="text-zinc-400 font-medium">
                            Start your journey with Selah Studio
                        </p>
                    </div>
                )}

                {signupStep === 'verify' && (
                    <div className="mb-8">
                        <h2 className="text-3xl font-bold text-zinc-100 mb-2 font-serif tracking-tight">
                            Verify your email
                        </h2>
                        <p className="text-zinc-400 font-medium leading-relaxed">
                            We've sent a 6-digit code to <strong className="text-zinc-100">{email}</strong>
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
                    <div className="flex p-1 rounded-xl mb-6" style={{ background: 'var(--bg-tertiary, #f5f5f4)' }}>
                        <button
                            onClick={() => switchMode('signin')}
                            className="flex-1 py-2.5 text-sm font-medium rounded-lg transition-all"
                            style={authMode === 'signin'
                                ? { background: 'var(--bg-card)', color: 'var(--text-primary)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
                                : { color: 'var(--text-muted)' }}>
                            Sign In
                        </button>
                        <button
                            onClick={() => switchMode('signup')}
                            className="flex-1 py-2.5 text-sm font-medium rounded-lg transition-all"
                            style={authMode === 'signup'
                                ? { background: 'var(--bg-card)', color: 'var(--text-primary)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
                                : { color: 'var(--text-muted)' }}>
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
                {/* Footer Credits */}
                <div className="mt-12 pt-8 border-t border-zinc-800 text-center">
                    <p className="text-xs text-zinc-400 flex items-center justify-center gap-2">
                        <Lock className="w-3 h-3" />
                        Secure, offline-first, and private scripture processing.
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
                <RightPanel />
            </div>
        </div>
    )
}