import { Link } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { gsap } from '../lib/gsap'
import { useScrollReveal } from '../hooks/useScrollReveal'
import {
    Music,
    Book,
    Video,
    Clock,
    Bell,
    Monitor,
    Users,
    Zap,
    Shield,
    Moon,
    Keyboard,
    RefreshCw,
    Play,
    Check,
    ArrowRight,
    Menu,
    X,
    Mic,
    Brain,
    Layers,
    Sparkles,
    WifiOff,
    LayoutDashboard,
    FileText,
    BookOpen,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────────────────────

const coreFeatures = [
    { icon: Music, title: 'Song & Hymn Library', description: "Every song your church loves, organised and ready. Build your library once, find anything in seconds during a live service.", accent: '#0d9488', gradient: 'from-purple-500 to-pink-500', tag: 'Core' },
    { icon: Book, title: 'Bible on Screen', description: 'Search any translation and display verses beautifully. Add your own Bible version and it works the same way.', accent: '#d97706', gradient: 'from-blue-500 to-cyan-500', tag: 'Core' },
    { icon: Video, title: 'Media & Video', description: 'Play YouTube clips, show announcement videos, or display images, all from the same screen you already use.', accent: '#be123c', gradient: 'from-orange-500 to-red-500', tag: 'Core' },
    { icon: Clock, title: 'Countdown Timers', description: 'Keep people engaged before the service begins. Beautiful countdowns you can set up in seconds.', accent: '#059669', gradient: 'from-green-500 to-emerald-500', tag: 'Core' },
    { icon: Bell, title: 'Live Announcements', description: 'Need to share something mid-service? Push a message to the screen instantly, with no interruption.', accent: '#4338ca', gradient: 'from-yellow-500 to-orange-500', tag: 'Core' },
    { icon: Monitor, title: 'Projection Output', description: 'Project to any connected screen with one click. Your congregation always sees the right content at the right time.', accent: '#0d9488', gradient: 'from-indigo-500 to-purple-500', tag: 'Live' },
]

const aiFeatures = [
    { icon: Mic, title: 'Listens as You Preach', description: 'Selah quietly listens through your microphone and follows your sermon in real time, with no manual input required.' },
    { icon: Brain, title: 'Understands Context', description: "Even when no verse is named, Selah reads between the lines and suggests scriptures that match what's being preached." },
    { icon: FileText, title: 'Catches Every Reference', description: 'Say "John chapter 3 verse 16" naturally and Selah finds it instantly, ready to display on screen.' },
    { icon: WifiOff, title: 'Works Without the Internet', description: 'Patchy church wifi? Selah keeps running so your service never misses a beat.' },
]

const dashboardFeatures = [
    { icon: LayoutDashboard, title: 'Drag-and-Drop Layout', description: 'Move panels wherever you like. Selah remembers your setup so every volunteer sees it their way.' },
    { icon: Layers, title: 'Service Order', description: 'Plan your entire service in advance. Switch between items during the service with a single click.' },
    { icon: Sparkles, title: 'Slide Styling', description: 'Change fonts, colours, and layout on any slide. No design experience needed.' },
    { icon: BookOpen, title: 'Reusable Templates', description: 'Save your favourite slide designs and reuse them week after week with one click.' },
]

const technicalHighlights = [
    { icon: RefreshCw, title: 'Instant Updates', description: 'Every change appears on every screen the moment you make it' },
    { icon: WifiOff, title: 'Works Offline', description: 'Keep going even if the internet drops. Selah never lets you down.' },
    { icon: Moon, title: 'Dark Mode', description: 'Easy on the eyes for late-night rehearsals and early-morning setup' },
    { icon: Keyboard, title: 'Keyboard Shortcuts', description: 'Navigate and control your service without touching the mouse' },
    { icon: Shield, title: 'Role Management', description: 'Give each volunteer exactly the access they need, nothing more.' },
    { icon: Users, title: 'Team Collaboration', description: 'Invite your whole media team in seconds with a simple invite code' },
]

const stats = [
    { value: 'Free', label: 'During Beta' },
    { value: '< 30min', label: 'Setup Time' },
    { value: '100%', label: 'Works Offline' },
    { value: '0', label: 'Credit Card Needed' },
]

const transcriptDemo = [
    { text: '...and as we reflect on the love of God, we turn to', delay: 0, isVerse: false, verse: null },
    { text: 'John chapter 3 verse 16,', delay: 1400, isVerse: true, verse: 'John 3:16' },
    { text: 'where we find that God so loved the world', delay: 3000, isVerse: false, verse: null },
    { text: 'that He gave His only Son...', delay: 4400, isVerse: false, verse: null },
]

// ─────────────────────────────────────────────────────────────
// NAV BAR
// ─────────────────────────────────────────────────────────────

function NavBar({ scrolled, mobileMenuOpen, setMobileMenuOpen }: {
    scrolled: boolean
    mobileMenuOpen: boolean
    setMobileMenuOpen: (v: boolean) => void
}) {
    return (
        <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 backdrop-blur-lg border-b ${scrolled
            ? 'bg-white/80 dark:bg-gray-950/90 border-gray-200/50 dark:border-gray-800/50 shadow-lg shadow-black/5'
            : 'bg-white/40 dark:bg-gray-950/30 border-transparent'
            }`}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    {/* Logo */}
                    <Link to="/" className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg shadow-primary-500/25"
                            style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)' }}>
                            <Music className="w-4.5 h-4.5 text-white" />
                        </div>
                        <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            Selah
                        </span>
                    </Link>

                    {/* Desktop nav links */}
                    <div className="hidden md:flex items-center gap-8">
                        <a href="#features" className="text-sm font-medium transition-colors text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Features</a>
                        <a href="#ai-listener" className="text-sm font-medium transition-colors text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">AI Listener</a>
                        <a href="#early-access" className="text-sm font-medium transition-colors text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Early Access</a>
                    </div>

                    {/* Desktop CTAs */}
                    <div className="hidden md:flex items-center gap-3">
                        <Link to="/login" className="text-sm font-medium transition-colors text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">
                            Sign In
                        </Link>
                        <Link to="/signup" className="px-4 py-2 text-sm font-semibold rounded-xl text-white transition-all hover:opacity-90 shadow-lg shadow-primary-500/25"
                            style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)' }}>
                            Get Started Free
                        </Link>
                    </div>

                    {/* Mobile toggle */}
                    <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden p-2 text-gray-600 dark:text-gray-300">
                        {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </button>
                </div>
            </div>

            {/* Mobile menu */}
            {mobileMenuOpen && (
                <div className="md:hidden bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800">
                    <div className="px-4 py-4 space-y-2">
                        <a href="#features" className="block py-2 text-sm text-gray-600 dark:text-gray-300">Features</a>
                        <a href="#ai-listener" className="block py-2 text-sm text-gray-600 dark:text-gray-300">AI Listener</a>
                        <a href="#early-access" className="block py-2 text-sm text-gray-600 dark:text-gray-300">Early Access</a>
                        <div className="pt-3 border-t border-gray-200 dark:border-gray-800 space-y-2">
                            <Link to="/login" className="block py-2 text-sm text-gray-600 dark:text-gray-300">Sign In</Link>
                            <Link to="/signup" className="block w-full py-3 text-center text-sm font-semibold rounded-xl text-white"
                                style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)' }}>
                                Get Started Free
                            </Link>
                        </div>
                    </div>
                </div>
            )}
        </nav>
    )
}

// ─────────────────────────────────────────────────────────────
// HERO SECTION
// ─────────────────────────────────────────────────────────────

function HeroSection() {
    const heroRef = useRef<HTMLElement>(null)

    useEffect(() => {
        const el = heroRef.current
        if (!el) return
        const ctx = gsap.context(() => {
            gsap.set(['.hero-badge', '.hero-line', '.hero-subtitle', '.hero-cta', '.hero-stat'], { opacity: 0 })
            const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
            tl.to('.hero-badge', { opacity: 1, scale: 1, y: 0, duration: 0.6, delay: 0.1 })
                .fromTo('.hero-line', { opacity: 0, y: 44 }, { opacity: 1, y: 0, duration: 0.75, stagger: 0.14 }, '-=0.35')
                .to('.hero-subtitle', { opacity: 1, y: 0, duration: 0.6 }, '-=0.25')
                .to('.hero-cta', { opacity: 1, y: 0, duration: 0.5, stagger: 0.1 }, '-=0.3')
                .to('.hero-stat', { opacity: 1, y: 0, duration: 0.45, stagger: 0.08 }, '-=0.2')
        }, el)
        return () => ctx.revert()
    }, [])

    return (
        <section ref={heroRef} className="relative pt-36 pb-28 lg:pt-48 lg:pb-40 overflow-hidden">
            {/* Gradient base */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary-50/50 via-white to-purple-50/30 dark:from-gray-950 dark:via-gray-950 dark:to-gray-950" />

            {/* Subtle grid pattern — same as original */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:24px_24px]" />

            {/* Animate-blob orbs */}
            <div className="absolute top-20 left-[10%] w-96 h-96 bg-primary-400/20 rounded-full blur-3xl animate-blob pointer-events-none" />
            <div className="absolute top-32 right-[8%] w-80 h-80 bg-amber-400/15 rounded-full blur-3xl animate-blob animation-delay-2000 pointer-events-none" />
            <div className="absolute bottom-10 left-1/3 w-72 h-72 bg-pink-400/15 rounded-full blur-3xl animate-blob animation-delay-4000 pointer-events-none" />

            <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center max-w-5xl mx-auto">
                    <div className="hero-badge inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-8 text-xs font-semibold uppercase tracking-widest"
                        style={{ background: 'rgba(13,148,136,0.12)', color: '#2dd4bf', border: '1px solid rgba(13,148,136,0.25)' }}>
                        <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" />
                        AI-Powered Worship Presentation
                    </div>
                    <h1 style={{ fontFamily: 'Crimson Pro, serif', fontSize: 'clamp(3rem, 8vw, 6rem)', fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.03em', color: 'var(--text-primary)' }} className="mb-6">
                        <span className="hero-line block">Every word.</span>
                        <span className="hero-line block" style={{ background: 'linear-gradient(135deg, #2dd4bf 0%, #0d9488 40%, #f59e0b 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                            Every verse.
                        </span>
                        <span className="hero-line block">Every moment.</span>
                    </h1>
                    <p className="hero-subtitle text-lg lg:text-xl max-w-2xl mx-auto mb-10 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        Selah listens to your sermon, detects scripture in real time, and puts the right verse on screen. Right when you need it.
                    </p>
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20">
                        <Link to="/signup" className="hero-cta group flex items-center gap-2 px-7 py-3.5 font-semibold rounded-2xl text-white transition-all hover:opacity-90 hover:shadow-xl"
                            style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)', boxShadow: '0 8px 32px rgba(13,148,136,0.3)' }}>
                            Start Free Trial
                            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                        </Link>
                        <Link to="/login" className="hero-cta flex items-center gap-2 px-7 py-3.5 font-semibold rounded-2xl transition-all hover:opacity-80"
                            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-default)', background: 'var(--bg-secondary)' }}>
                            <Play className="w-4 h-4" style={{ color: '#2dd4bf' }} />
                            Sign In
                        </Link>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-8 lg:gap-16">
                        {stats.map((s) => (
                            <div key={s.label} className="hero-stat text-center">
                                <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '2.25rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{s.value}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    )
}

// ─────────────────────────────────────────────────────────────
// SERMON LISTENER SECTION
// ─────────────────────────────────────────────────────────────

function SermonListenerSection({ activeTranscriptLine, detectedVerse }: { activeTranscriptLine: number; detectedVerse: string | null }) {
    const colLeftRef = useScrollReveal<HTMLDivElement>('fade-right', { start: 'top 82%' })
    const colRightRef = useScrollReveal<HTMLDivElement>('fade-left', { start: 'top 82%', delay: 0.1 })
    return (
        <section id="ai-listener" className="py-24 lg:py-36 bg-gray-50 dark:bg-gray-900/50 relative overflow-hidden">
            {/* Animate-blob orbs */}
            <div className="absolute top-1/4 -left-24 w-96 h-96 bg-primary-500/15 rounded-full blur-3xl animate-blob pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-80 h-80 bg-amber-400/10 rounded-full blur-3xl animate-blob animation-delay-2000 pointer-events-none" />
            <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid lg:grid-cols-2 gap-16 items-center">
                    <div ref={colLeftRef}>
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6 text-xs font-semibold uppercase tracking-widest"
                            style={{ background: 'rgba(13,148,136,0.12)', color: '#2dd4bf', border: '1px solid rgba(13,148,136,0.25)' }}>
                            <Mic className="w-3 h-3" /> AI Sermon Listener
                        </div>
                        <h2 style={{ fontFamily: 'Crimson Pro, serif', fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: 700, lineHeight: 1.1, color: 'var(--text-primary)' }} className="mb-5">
                            Scripture surfaces itself.<br />
                            <span style={{ color: '#2dd4bf' }}>You just preach.</span>
                        </h2>
                        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }} className="mb-8">
                            Selah listens quietly in the background as your pastor preaches. The moment a scripture is mentioned, or even just implied, the right verse is ready to appear on screen. No scrambling, no missed moments.
                        </p>
                        <div className="space-y-4">
                            {aiFeatures.map((f) => (
                                <div key={f.title} className="flex gap-4 p-4 rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                                    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(13,148,136,0.15)' }}>
                                        <f.icon className="w-4 h-4" style={{ color: '#2dd4bf' }} />
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>{f.title}</div>
                                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.825rem', marginTop: '0.25rem', lineHeight: 1.6 }}>{f.description}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div ref={colRightRef} className="relative">
                        <div className="rounded-3xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', boxShadow: '0 32px 80px rgba(0,0,0,0.4)' }}>
                            <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-secondary)' }}>
                                <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#ef4444' }} />
                                <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#f59e0b' }} />
                                <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#22c55e' }} />
                                <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>Sermon Listener · Live</span>
                                <span className="ml-auto flex items-center gap-1.5 text-xs font-medium" style={{ color: '#22c55e' }}>
                                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> Listening
                                </span>
                            </div>
                            <div className="p-6 space-y-3">
                                <div className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>Live Transcript</div>
                                {transcriptDemo.map((line, i) => (
                                    <div key={i} className={`text-sm leading-relaxed transition-all duration-500 ${i <= activeTranscriptLine ? 'opacity-100' : 'opacity-0'}`}
                                        style={{ color: line.isVerse && i === activeTranscriptLine ? '#2dd4bf' : 'var(--text-secondary)', fontWeight: line.isVerse && i === activeTranscriptLine ? 600 : 400 }}>
                                        {line.text}
                                        {line.isVerse && i <= activeTranscriptLine && (
                                            <span className="ml-2 px-1.5 py-0.5 rounded text-xs" style={{ background: 'rgba(13,148,136,0.2)', color: '#2dd4bf', fontFamily: 'monospace' }}>
                                                detected
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                            {detectedVerse && (
                                <div className="mx-6 mb-6 p-4 rounded-2xl animate-pulse-once" style={{ background: 'linear-gradient(135deg, rgba(13,148,136,0.2), rgba(13,148,136,0.08))', border: '1px solid rgba(13,148,136,0.3)' }}>
                                    <div className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#2dd4bf' }}>Queued for Display</div>
                                    <div className="font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'Crimson Pro, serif', fontSize: '1.1rem' }}>{detectedVerse}</div>
                                    <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Ready to push to projection</div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}

// ─────────────────────────────────────────────────────────────
// CORE FEATURES SECTION
// ─────────────────────────────────────────────────────────────

function CoreFeaturesSection() {
    const headingRef = useScrollReveal<HTMLDivElement>('fade-up', { start: 'top 88%' })
    const gridRef = useScrollReveal<HTMLDivElement>('stagger', { start: 'top 85%', staggerAmount: 0.07 })
    return (
        <section id="features" className="py-24 lg:py-36 bg-gray-50 dark:bg-gray-900/50 relative overflow-hidden">
            {/* Blob decoration — top-right */}
            <div className="absolute top-0 left-0 w-72 h-72 bg-primary-500/10 rounded-full blur-3xl -translate-x-1/2 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-72 h-72 bg-purple-500/10 rounded-full blur-3xl translate-x-1/2 pointer-events-none" />
            <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div ref={headingRef} className="text-center mb-16">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-sm font-medium">
                        <Zap className="w-4 h-4" /> Core Features
                    </div>
                    <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white mb-4">
                        Everything your media team needs
                    </h2>
                    <p className="text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
                        Songs, scripture, media, countdowns, announcements. All in one unified platform built for live services.
                    </p>
                </div>
                <div ref={gridRef} className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {coreFeatures.map((f) => (
                        <div key={f.title}
                            className="group relative bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg shadow-gray-200/50 dark:shadow-none border border-gray-100 dark:border-gray-700 hover:border-primary-200 dark:hover:border-primary-800 transition-all duration-300 hover:-translate-y-1">
                            {/* Small accent icon + tag row — new landing style */}
                            <div className="flex items-start justify-between mb-4">
                                <div className="w-11 h-11 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300"
                                    style={{ background: `${f.accent}18` }}>
                                    <f.icon className="w-5 h-5" style={{ color: f.accent }} />
                                </div>
                                <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                                    style={{ background: `${f.accent}15`, color: f.accent }}>{f.tag}</span>
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{f.title}</h3>
                            <p className="text-gray-600 dark:text-gray-300 text-sm leading-relaxed">{f.description}</p>
                            {/* Hover gradient overlay */}
                            <div className={`absolute inset-0 bg-gradient-to-br ${f.gradient} opacity-0 group-hover:opacity-5 rounded-2xl transition-opacity duration-300`} />
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}

// ─────────────────────────────────────────────────────────────
// DASHBOARD SECTION
// ─────────────────────────────────────────────────────────────

function DashboardSection() {
    const colLeftRef = useScrollReveal<HTMLDivElement>('fade-right', { start: 'top 82%' })
    const colRightRef = useScrollReveal<HTMLDivElement>('scale', { start: 'top 82%', delay: 0.15 })
    return (
        <section className="py-24 lg:py-36 relative overflow-hidden">
            <div className="absolute inset-0" style={{ background: 'var(--bg-secondary)' }} />
            <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 60% 60% at 70% 50%, rgba(245,158,11,0.06) 0%, transparent 70%)' }} />
            <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid lg:grid-cols-2 gap-16 items-center">
                    <div ref={colLeftRef}>
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6 text-xs font-semibold uppercase tracking-widest"
                            style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.2)' }}>
                            <LayoutDashboard className="w-3 h-3" /> Adaptive Dashboard
                        </div>
                        <h2 style={{ fontFamily: 'Crimson Pro, serif', fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: 700, lineHeight: 1.1, color: 'var(--text-primary)' }} className="mb-5">
                            Your layout,<br />
                            <span style={{ color: '#f59e0b' }}>your way.</span>
                        </h2>
                        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }} className="mb-8">
                            Selah's drag-and-drop dashboard adapts to every volunteer's workflow. Resize and reposition every panel. Your layout is saved per user, per church.
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                            {dashboardFeatures.map((f) => (
                                <div key={f.title} className="p-4 rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                                    <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-3" style={{ background: 'rgba(245,158,11,0.12)' }}>
                                        <f.icon className="w-4 h-4" style={{ color: '#f59e0b' }} />
                                    </div>
                                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>{f.title}</div>
                                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.775rem', marginTop: '0.25rem', lineHeight: 1.5 }}>{f.description}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div ref={colRightRef} className="rounded-3xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', boxShadow: '0 32px 80px rgba(0,0,0,0.4)' }}>
                        <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-secondary)' }}>
                            <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#ef4444' }} />
                            <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#f59e0b' }} />
                            <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#22c55e' }} />
                            <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>Selah Dashboard</span>
                        </div>
                        <div className="p-4 grid grid-cols-3 gap-2 text-xs" style={{ minHeight: '320px' }}>
                            {[
                                { label: 'Quick Actions', col: 'col-span-1', h: 'row-span-2', accent: '#0d9488' },
                                { label: 'Live Preview', col: 'col-span-2', h: '', accent: '#be123c' },
                                { label: 'Schedule', col: 'col-span-2', h: '', accent: '#4338ca' },
                                { label: 'AI Listener', col: 'col-span-2', h: '', accent: '#0d9488' },
                                { label: 'Library', col: 'col-span-1', h: 'row-span-2', accent: '#d97706' },
                            ].map((p) => (
                                <div key={p.label} className={`${p.col} ${p.h} flex items-center justify-center rounded-xl p-3 font-medium`}
                                    style={{ background: `${p.accent}12`, border: `1px solid ${p.accent}25`, color: p.accent, minHeight: '64px' }}>
                                    {p.label}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}

// ─────────────────────────────────────────────────────────────
// TECH HIGHLIGHTS SECTION
// ─────────────────────────────────────────────────────────────

function TechHighlightsSection() {
    const headingRef = useScrollReveal<HTMLDivElement>('fade-up', { start: 'top 88%' })
    const gridRef = useScrollReveal<HTMLDivElement>('stagger-fast', { start: 'top 85%', staggerAmount: 0.06 })
    return (
        <section className="py-20 bg-gradient-to-r from-primary-600 via-purple-600 to-pink-600 relative overflow-hidden">
            {/* White grid overlay — exact match to original */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff10_1px,transparent_1px),linear-gradient(to_bottom,#ffffff10_1px,transparent_1px)] bg-[size:24px_24px]" />
            <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div ref={headingRef} className="text-center mb-12">
                    <h2 style={{ fontFamily: 'Crimson Pro, serif', fontSize: 'clamp(1.75rem, 3.5vw, 2.5rem)', fontWeight: 700, color: '#ffffff' }} className="mb-3">
                        Built for the realities of live services
                    </h2>
                    <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '1rem' }}>Rock-solid technology under the hood, invisible when everything goes right.</p>
                </div>
                <div ref={gridRef} className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    {technicalHighlights.map((h) => (
                        <div key={h.title} className="text-center p-4 rounded-2xl" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: 'rgba(255,255,255,0.12)' }}>
                                <h.icon className="w-5 h-5 text-white" />
                            </div>
                            <div style={{ fontWeight: 600, color: '#ffffff', fontSize: '0.8rem', marginBottom: '0.35rem' }}>{h.title}</div>
                            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.7rem', lineHeight: 1.5 }}>{h.description}</div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}

// ─────────────────────────────────────────────────────────────
// EARLY ACCESS SECTION (Founding Churches)
// ─────────────────────────────────────────────────────────────

const foundingPerks = [
    { title: 'Free During Beta', description: 'Full access at no cost while we build together.' },
    { title: 'Shape the Roadmap', description: 'Your feedback and requests directly influence what we build next.' },
    { title: 'Direct Founder Access', description: 'Personal support from our founding team, not a support bot.' },
    { title: 'Locked-in Discount', description: '50% off your plan for life when we officially launch.' },
]

function EarlyAccessSection() {
    const sectionRef = useScrollReveal<HTMLElement>('fade-up', { start: 'top 88%' })
    return (
        <section ref={sectionRef} id="early-access" className="py-24 lg:py-36 bg-gray-50 dark:bg-gray-900/50 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-96 h-96 bg-primary-500/5 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />
            <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                {/* Card */}
                <div className="bg-white dark:bg-gray-800 border-2 border-primary-500/40 rounded-3xl p-10 md:p-16 text-center shadow-2xl shadow-primary-500/10">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-6 text-xs font-bold uppercase tracking-widest"
                        style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)', color: '#ffffff' }}>
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                        Limited Early Access
                    </div>
                    <h2 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-5 leading-tight">
                        Be a Founding Church
                    </h2>
                    <p className="text-lg text-gray-600 dark:text-gray-300 mb-10 max-w-2xl mx-auto leading-relaxed">
                        Selah is just getting started. We're inviting the first 25 churches to join us, help shape the platform, and lock in exclusive benefits that will never be offered again.
                    </p>

                    {/* Perks grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-10 text-left">
                        {foundingPerks.map((perk) => (
                            <div key={perk.title} className="flex items-start gap-4">
                                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                                    style={{ background: 'rgba(13,148,136,0.12)' }}>
                                    <Check className="w-4 h-4" style={{ color: '#0d9488' }} />
                                </div>
                                <div>
                                    <div className="font-semibold text-gray-900 dark:text-white mb-0.5">{perk.title}</div>
                                    <div className="text-sm text-gray-500 dark:text-gray-400">{perk.description}</div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <Link to="/signup"
                        className="inline-flex items-center gap-2 px-8 py-4 font-semibold rounded-2xl text-white text-lg transition-all hover:opacity-90 hover:shadow-xl"
                        style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)', boxShadow: '0 8px 32px rgba(13,148,136,0.3)' }}>
                        Apply for Early Access
                        <ArrowRight className="w-5 h-5" />
                    </Link>
                    <p className="mt-5 text-sm text-gray-400 italic">
                        Free to join · No credit card · Spots going fast
                    </p>
                </div>
            </div>
        </section>
    )
}

// ─────────────────────────────────────────────────────────────
// PRICING SECTION
// ─────────────────────────────────────────────────────────────

function PricingSection() {
    const headingRef = useScrollReveal<HTMLDivElement>('fade-up', { start: 'top 88%' })
    const plansRef = useScrollReveal<HTMLDivElement>('stagger', { start: 'top 85%', staggerAmount: 0.1 })
    const plans = [
        {
            name: 'Free', price: '$0', period: 'forever', description: 'Perfect for getting started and smaller congregations.',
            features: ['Songs & hymn library', 'Bible verse display', 'Countdown timers', 'Basic announcements', 'Up to 3 team members'],
            cta: 'Start Free', href: '/signup', highlighted: false,
        },
        {
            name: 'Pro', price: '$19', period: 'per month', description: 'Everything your media team needs for a great service.',
            features: ['Everything in Free', 'AI Sermon Listener', 'Works online or fully offline', 'Smart scripture suggestions', 'Project to multiple screens', 'Unlimited team members', 'Keep the service running without internet', 'Priority support'],
            cta: 'Start Pro Trial', href: '/signup', highlighted: true,
        },
        {
            name: 'Church', price: '$49', period: 'per month', description: 'For larger churches with advanced needs.',
            features: ['Everything in Pro', 'Multiple service schedules', 'Custom Bible versions', 'Advanced role management', 'Analytics & reporting', 'Dedicated support'],
            cta: 'Contact Us', href: '/signup', highlighted: false,
        },
    ]
    return (
        <section id="pricing" className="py-24 lg:py-36" style={{ background: 'var(--bg-secondary)' }}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div ref={headingRef} className="text-center mb-16">
                    <h2 style={{ fontFamily: 'Crimson Pro, serif', fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: 700, color: 'var(--text-primary)' }} className="mb-4">
                        Simple, honest pricing
                    </h2>
                    <p style={{ color: 'var(--text-secondary)' }}>Start free. Upgrade when you're ready. No long-term contracts.</p>
                </div>
                <div ref={plansRef} className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto items-start">
                    {plans.map((p) => (
                        <div key={p.name} className={`p-7 rounded-3xl flex flex-col relative ${p.highlighted ? 'scale-105 shadow-2xl shadow-primary-500/20' : ''}`} style={{
                            background: p.highlighted ? 'linear-gradient(160deg, #0d9488 0%, #7c3aed 100%)' : 'var(--bg-card)',
                            border: p.highlighted ? 'none' : '1px solid var(--border-default)',
                        }}>
                            {p.highlighted && (
                                <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-yellow-400 to-orange-400 text-gray-900 text-xs font-bold rounded-full">
                                    Most Popular
                                </div>
                            )}
                            <div className="mb-1 text-lg font-bold" style={{ color: p.highlighted ? '#ffffff' : 'var(--text-primary)' }}>{p.name}</div>
                            <div className="flex items-baseline gap-1 mb-2">
                                <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '2.75rem', fontWeight: 700, color: p.highlighted ? '#ffffff' : 'var(--text-primary)' }}>{p.price}</span>
                                <span className="text-sm" style={{ color: p.highlighted ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)' }}>/{p.period}</span>
                            </div>
                            <p className="text-sm leading-relaxed mb-6" style={{ color: p.highlighted ? 'rgba(255,255,255,0.8)' : 'var(--text-secondary)' }}>{p.description}</p>
                            <ul className="space-y-2.5 mb-8 flex-grow">
                                {p.features.map((f) => (
                                    <li key={f} className="flex items-start gap-2.5">
                                        <Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: p.highlighted ? '#ffffff' : '#059669' }} />
                                        <span className="text-sm" style={{ color: p.highlighted ? 'rgba(255,255,255,0.85)' : 'var(--text-secondary)' }}>{f}</span>
                                    </li>
                                ))}
                            </ul>
                            <Link to={p.href} className="block w-full py-3 text-center font-semibold rounded-2xl transition-all text-sm"
                                style={p.highlighted ? {
                                    background: '#ffffff', color: '#0d9488',
                                } : {
                                    background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-default)'
                                }}>
                                {p.cta}
                            </Link>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}

// ─────────────────────────────────────────────────────────────
// CTA SECTION
// ─────────────────────────────────────────────────────────────

function CtaSection() {
    const contentRef = useScrollReveal<HTMLDivElement>('fade-up', { start: 'top 88%' })
    return (
        <section className="py-24 lg:py-36 bg-gradient-to-br from-primary-600 via-purple-600 to-pink-600 relative overflow-hidden">
            {/* White grid overlay */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff10_1px,transparent_1px),linear-gradient(to_bottom,#ffffff10_1px,transparent_1px)] bg-[size:24px_24px]" />
            {/* Floating animate-float elements */}
            <div className="absolute top-10 left-10 w-20 h-20 bg-white/10 rounded-full blur-xl animate-float pointer-events-none" />
            <div className="absolute bottom-10 right-10 w-32 h-32 bg-white/10 rounded-full blur-xl animate-float animation-delay-2000 pointer-events-none" />
            <div className="absolute top-1/2 right-1/4 w-16 h-16 bg-white/10 rounded-full blur-xl animate-float animation-delay-4000 pointer-events-none" />

            <div ref={contentRef} className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6 leading-tight">
                    Ready to give your media team<br />a head start?
                </h2>
                <p className="text-xl text-white/80 mb-10 max-w-2xl mx-auto">
                    Be part of the first wave. Join free during our beta. No credit card, no commitment. Just better services, starting Sunday.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                    <Link to="/signup" className="group flex items-center gap-2 px-8 py-4 bg-white text-primary-600 font-semibold rounded-2xl hover:bg-gray-100 transition-all shadow-xl text-lg">
                        Get Started Free
                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </Link>
                    <Link to="/login" className="px-8 py-4 text-white font-semibold rounded-2xl border-2 border-white/30 hover:bg-white/10 transition-all text-lg">
                        Sign In
                    </Link>
                </div>
            </div>
        </section>
    )
}

// ─────────────────────────────────────────────────────────────
// FOOTER SECTION
// ─────────────────────────────────────────────────────────────

function FooterSection() {
    return (
        <footer className="bg-gray-900 dark:bg-gray-950 py-16 border-t border-gray-800">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                {/* 4-column grid */}
                <div className="grid md:grid-cols-4 gap-12 mb-12">
                    {/* Brand */}
                    <div className="md:col-span-1">
                        <Link to="/" className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                                style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)' }}>
                                <Music className="w-5 h-5 text-white" />
                            </div>
                            <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '1.25rem', fontWeight: 600 }} className="text-white">Selah</span>
                        </Link>
                        <p className="text-gray-400 text-sm leading-relaxed">
                            A modern, AI-powered worship presentation platform built for churches.
                        </p>
                    </div>

                    {/* Product */}
                    <div>
                        <h4 className="font-semibold text-white mb-4">Product</h4>
                        <ul className="space-y-2">
                            {['Features', 'AI Listener', 'Pricing', 'Templates'].map((link) => (
                                <li key={link}>
                                    <a href="#" className="text-gray-400 hover:text-white transition-colors text-sm">{link}</a>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Resources */}
                    <div>
                        <h4 className="font-semibold text-white mb-4">Resources</h4>
                        <ul className="space-y-2">
                            {['Documentation', 'Whisper Setup', 'Blog', 'Community'].map((link) => (
                                <li key={link}>
                                    <a href="#" className="text-gray-400 hover:text-white transition-colors text-sm">{link}</a>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Company */}
                    <div>
                        <h4 className="font-semibold text-white mb-4">Company</h4>
                        <ul className="space-y-2">
                            {['About', 'Contact', 'Privacy', 'Terms'].map((link) => (
                                <li key={link}>
                                    <a href="#" className="text-gray-400 hover:text-white transition-colors text-sm">{link}</a>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                {/* Bottom bar */}
                <div className="pt-8 border-t border-gray-800 flex flex-col md:flex-row items-center justify-between gap-4">
                    <p className="text-gray-400 text-sm">
                        © {new Date().getFullYear()} Selah. Built for the Church.
                    </p>
                    <div className="flex items-center gap-6">
                        <a href="#" className="text-gray-400 hover:text-white transition-colors text-sm">Privacy Policy</a>
                        <a href="#" className="text-gray-400 hover:text-white transition-colors text-sm">Terms of Service</a>
                    </div>
                </div>
            </div>
        </footer>
    )
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT (shell + sub-components)
// ─────────────────────────────────────────────────────────────

export default function Landing() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
    const [activeTranscriptLine, setActiveTranscriptLine] = useState(-1)
    const [detectedVerse, setDetectedVerse] = useState<string | null>(null)
    const [scrolled, setScrolled] = useState(false)

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 20)
        window.addEventListener('scroll', onScroll, { passive: true })
        return () => window.removeEventListener('scroll', onScroll)
    }, [])

    useEffect(() => {
        let timeouts: ReturnType<typeof setTimeout>[] = []
        const run = () => {
            setActiveTranscriptLine(-1)
            setDetectedVerse(null)
            transcriptDemo.forEach((line, i) => {
                const t = setTimeout(() => {
                    setActiveTranscriptLine(i)
                    if (line.isVerse && line.verse) {
                        setTimeout(() => setDetectedVerse(line.verse!), 500)
                    }
                }, line.delay + 600)
                timeouts.push(t)
            })
            timeouts.push(setTimeout(run, 7500))
        }
        timeouts.push(setTimeout(run, 1000))
        return () => timeouts.forEach(clearTimeout)
    }, [])

    return (
        <div className="dark min-h-screen overflow-hidden" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', position: 'relative' }}>
            {/* Global grid layer — sits behind everything */}
            <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0, opacity: 0.45, backgroundImage: 'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)', backgroundSize: '52px 52px' }} />
            <NavBar scrolled={scrolled} mobileMenuOpen={mobileMenuOpen} setMobileMenuOpen={setMobileMenuOpen} />
            <HeroSection />
            <SermonListenerSection activeTranscriptLine={activeTranscriptLine} detectedVerse={detectedVerse} />
            <CoreFeaturesSection />
            <DashboardSection />
            <TechHighlightsSection />
            <EarlyAccessSection />
            {/* <PricingSection /> — hidden during beta */}
            <CtaSection />
            <FooterSection />
        </div>
    )
}
