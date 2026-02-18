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
    Star,
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
    { icon: Music, title: 'Song & Hymn Library', description: "Build your church's complete song library with verse/chorus structure. Access thousands of hymns instantly.", accent: '#0d9488', tag: 'Core' },
    { icon: Book, title: 'Bible Display', description: 'Search any translation instantly. Upload your own Bible versions via CSV and display verses with rich formatting.', accent: '#d97706', tag: 'Core' },
    { icon: Video, title: 'Media Integration', description: 'Stream YouTube, Vimeo, or display local images and video. Full rich media support for dynamic services.', accent: '#be123c', tag: 'Core' },
    { icon: Clock, title: 'Countdown Timers', description: 'Create beautiful pre-service countdown timers. Keep your congregation engaged before the service begins.', accent: '#059669', tag: 'Core' },
    { icon: Bell, title: 'Live Announcements', description: 'Push priority alerts to the screen instantly. Keep your congregation informed in the right moment.', accent: '#4338ca', tag: 'Core' },
    { icon: Monitor, title: 'Multi-Monitor Output', description: 'Separate fullscreen projection via Presentation API. Pick exactly which display receives the live output.', accent: '#0d9488', tag: 'Live' },
]

const aiFeatures = [
    { icon: Mic, title: 'Live Transcription', description: '4 provider options: Browser Web Speech, local offline Whisper.cpp, remote Whisper API, or ElevenLabs cloud.' },
    { icon: Brain, title: 'Semantic Verse Detection', description: "In-browser ML embeddings (Xenova/transformers) surface contextually relevant scriptures — even when a reference isn't spoken." },
    { icon: FileText, title: 'Regex Reference Parser', description: 'Spoken patterns like "John three sixteen" are parsed instantly and queued for display.' },
    { icon: WifiOff, title: 'Fully Offline Option', description: 'Run Whisper.cpp in Docker on your local machine — nothing leaves your network.' },
]

const dashboardFeatures = [
    { icon: LayoutDashboard, title: 'Draggable Panels', description: 'Fully customisable layout using react-grid-layout. Every panel position is persisted per user.' },
    { icon: Layers, title: 'Service Schedules', description: 'Organise slides into named schedules. Structure your entire service order in advance.' },
    { icon: Sparkles, title: 'Rich Text Editor', description: 'TipTap-powered editor with font family, colour, alignment, and highlight controls.' },
    { icon: BookOpen, title: 'Slide Templates', description: 'Save and reuse slide designs across services. Consistent branding with one click.' },
]

const technicalHighlights = [
    { icon: RefreshCw, title: 'Real-time Sync', description: 'Convex subscriptions push changes to all devices instantly' },
    { icon: WifiOff, title: 'Offline Support', description: 'IndexedDB via Dexie keeps the app functional without a network' },
    { icon: Moon, title: 'Dark Mode', description: 'Full dark mode throughout with warm, reverent palette' },
    { icon: Keyboard, title: 'Keyboard Shortcuts', description: 'Undo/redo, fullscreen, quick slide navigation' },
    { icon: Shield, title: 'Role-Based Access', description: 'Admin, owner, and member roles with feature-gated panels' },
    { icon: Users, title: 'Team Collaboration', description: 'Invite your whole media team with a simple invite code' },
]

const testimonials = [
    { quote: "The AI sermon listener changed everything for our media team. Verses appear on screen before I even have to think about it.", author: "Pastor Michael A.", role: "Worship Director", church: "Grace Community Church", initials: "MA" },
    { quote: "The draggable dashboard means every volunteer sets it up exactly how they want. Training time dropped by 80%.", author: "Sarah K.", role: "Media Ministry Lead", church: "New Life Fellowship", initials: "SK" },
    { quote: "We run Whisper.cpp offline during services. Zero latency, zero data leaving our network. This is the future.", author: "David O.", role: "Technical Director", church: "Harvest Church", initials: "DO" },
]

const stats = [
    { value: '500+', label: 'Churches' },
    { value: '4', label: 'AI Providers' },
    { value: '99.9%', label: 'Uptime' },
    { value: '0ms', label: 'Offline Latency' },
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
        <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${scrolled ? 'border-b shadow-2xl' : 'bg-transparent'
            }`}
            style={scrolled ? {
                background: 'rgba(12,10,9,0.92)',
                backdropFilter: 'blur(20px)',
                borderColor: 'rgba(255,255,255,0.06)',
            } : {}}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    <Link to="/" className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                            style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)' }}>
                            <Music className="w-4 h-4 text-white" />
                        </div>
                        <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            Selah
                        </span>
                    </Link>
                    <div className="hidden md:flex items-center gap-8">
                        <a href="#features" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 500 }} className="transition-colors hover:text-primary-400">Features</a>
                        <a href="#ai-listener" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 500 }} className="transition-colors hover:text-primary-400">AI Listener</a>
                        <a href="#pricing" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 500 }} className="transition-colors hover:text-primary-400">Pricing</a>
                    </div>
                    <div className="hidden md:flex items-center gap-3">
                        <Link to="/login" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 500 }} className="transition-colors hover:text-primary-400">Sign In</Link>
                        <Link to="/signup" className="px-4 py-2 text-sm font-semibold rounded-xl text-white transition-all hover:opacity-90"
                            style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)' }}>Get Started Free</Link>
                    </div>
                    <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden p-2" style={{ color: 'var(--text-secondary)' }}>
                        {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </button>
                </div>
            </div>
            {mobileMenuOpen && (
                <div className="md:hidden border-t" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-default)' }}>
                    <div className="px-4 py-4 space-y-2">
                        <a href="#features" className="block py-2 text-sm" style={{ color: 'var(--text-secondary)' }}>Features</a>
                        <a href="#ai-listener" className="block py-2 text-sm" style={{ color: 'var(--text-secondary)' }}>AI Listener</a>
                        <a href="#pricing" className="block py-2 text-sm" style={{ color: 'var(--text-secondary)' }}>Pricing</a>
                        <div className="pt-3 border-t space-y-2" style={{ borderColor: 'var(--border-default)' }}>
                            <Link to="/login" className="block py-2 text-sm" style={{ color: 'var(--text-secondary)' }}>Sign In</Link>
                            <Link to="/signup" className="block w-full py-3 text-center text-sm font-semibold rounded-xl text-white"
                                style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)' }}>Get Started Free</Link>
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
            <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(13,148,136,0.12) 0%, transparent 70%), radial-gradient(ellipse 60% 40% at 80% 50%, rgba(245,158,11,0.06) 0%, transparent 60%), var(--bg-primary)' }} />
            <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)', backgroundSize: '48px 48px' }} />
            <div className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(13,148,136,0.15) 0%, transparent 70%)', filter: 'blur(40px)' }} />
            <div className="absolute top-1/3 right-1/4 w-80 h-80 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.08) 0%, transparent 70%)', filter: 'blur(60px)' }} />
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
                        Selah listens to your sermon, detects scripture in real time, and puts the right verse on screen — before you even ask.
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
        <section id="ai-listener" className="py-24 lg:py-36 relative overflow-hidden">
            <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 70% 60% at 30% 50%, rgba(13,148,136,0.08) 0%, transparent 70%), var(--bg-secondary)' }} />
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
                            Selah's AI listens continuously to your sermon. It parses spoken verse references, detects contextually relevant scriptures using in-browser ML embeddings, and queues them for display — all in real time.
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
                                <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>Sermon Listener — Live</span>
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
        <section id="features" className="py-24 lg:py-36 relative">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div ref={headingRef} className="text-center mb-16">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5 text-xs font-semibold uppercase tracking-widest"
                        style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.2)' }}>
                        <Zap className="w-3 h-3" /> Core Features
                    </div>
                    <h2 style={{ fontFamily: 'Crimson Pro, serif', fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: 700, color: 'var(--text-primary)' }} className="mb-4">
                        Everything your media team needs
                    </h2>
                    <p style={{ color: 'var(--text-secondary)', maxWidth: '36rem', margin: '0 auto' }}>
                        Songs, scripture, media, countdowns, announcements — all in one unified, real-time platform built for live services.
                    </p>
                </div>
                <div ref={gridRef} className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {coreFeatures.map((f) => (
                        <div key={f.title} className="group relative p-6 rounded-3xl transition-all duration-300 hover:-translate-y-1"
                            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                            <div className="absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                                style={{ background: `radial-gradient(circle at 30% 30%, ${f.accent}15 0%, transparent 60%)` }} />
                            <div className="relative">
                                <div className="flex items-start justify-between mb-4">
                                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
                                        style={{ background: `${f.accent}18` }}>
                                        <f.icon className="w-5 h-5" style={{ color: f.accent }} />
                                    </div>
                                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                                        style={{ background: `${f.accent}15`, color: f.accent }}>{f.tag}</span>
                                </div>
                                <h3 style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>{f.title}</h3>
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.7 }}>{f.description}</p>
                            </div>
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
                            Selah's drag-and-drop dashboard adapts to every volunteer's workflow. Resize and reposition every panel — your layout is saved per user, per church.
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
        <section className="py-20 relative overflow-hidden">
            <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #0d9488 0%, #0f766e 50%, #134e4a 100%)' }} />
            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
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
// TESTIMONIALS SECTION
// ─────────────────────────────────────────────────────────────

function TestimonialsSection() {
    const headingRef = useScrollReveal<HTMLDivElement>('fade-up', { start: 'top 88%' })
    const cardsRef = useScrollReveal<HTMLDivElement>('stagger', { start: 'top 85%', staggerAmount: 0.1 })
    return (
        <section className="py-24 lg:py-36">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div ref={headingRef} className="text-center mb-16">
                    <div className="flex items-center justify-center gap-1 mb-4">
                        {[1, 2, 3, 4, 5].map((i) => <Star key={i} className="w-5 h-5 fill-amber-400 text-amber-400" />)}
                    </div>
                    <h2 style={{ fontFamily: 'Crimson Pro, serif', fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: 700, color: 'var(--text-primary)' }}>
                        Trusted by church media teams
                    </h2>
                </div>
                <div ref={cardsRef} className="grid md:grid-cols-3 gap-6">
                    {testimonials.map((t) => (
                        <div key={t.author} className="p-7 rounded-3xl flex flex-col" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                            <div className="flex items-center gap-1 mb-5">
                                {[1, 2, 3, 4, 5].map((i) => <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />)}
                            </div>
                            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, fontSize: '0.925rem', flexGrow: 1 }} className="mb-6 italic">"{t.quote}"</p>
                            <div className="flex items-center gap-3 pt-5 border-t" style={{ borderColor: 'var(--border-default)' }}>
                                <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                                    style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)' }}>{t.initials}</div>
                                <div>
                                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>{t.author}</div>
                                    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{t.role} · {t.church}</div>
                                </div>
                            </div>
                        </div>
                    ))}
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
            features: ['Everything in Free', 'AI Sermon Listener', 'All 4 transcription providers', 'Semantic verse detection', 'Multi-monitor output', 'Unlimited team members', 'Offline Whisper.cpp support', 'Priority support'],
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
                <div ref={plansRef} className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
                    {plans.map((p) => (
                        <div key={p.name} className="p-7 rounded-3xl flex flex-col relative" style={{
                            background: p.highlighted ? 'linear-gradient(135deg, rgba(13,148,136,0.15), rgba(13,148,136,0.05))' : 'var(--bg-card)',
                            border: p.highlighted ? '1px solid rgba(13,148,136,0.4)' : '1px solid var(--border-default)',
                            boxShadow: p.highlighted ? '0 16px 64px rgba(13,148,136,0.15)' : 'none',
                        }}>
                            {p.highlighted && (
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-xs font-bold text-white"
                                    style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)' }}>Most Popular</div>
                            )}
                            <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1.1rem' }} className="mb-1">{p.name}</div>
                            <div className="flex items-baseline gap-1 mb-2">
                                <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '2.75rem', fontWeight: 700, color: p.highlighted ? '#2dd4bf' : 'var(--text-primary)' }}>{p.price}</span>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.825rem' }}>/{p.period}</span>
                            </div>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.825rem', lineHeight: 1.6 }} className="mb-6">{p.description}</p>
                            <ul className="space-y-2.5 mb-8 flex-grow">
                                {p.features.map((f) => (
                                    <li key={f} className="flex items-start gap-2.5">
                                        <Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: p.highlighted ? '#2dd4bf' : '#059669' }} />
                                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.825rem' }}>{f}</span>
                                    </li>
                                ))}
                            </ul>
                            <Link to={p.href} className="block w-full py-3 text-center font-semibold rounded-2xl transition-all text-sm"
                                style={p.highlighted ? {
                                    background: 'linear-gradient(135deg, #0d9488, #0f766e)', color: '#ffffff', boxShadow: '0 8px 24px rgba(13,148,136,0.3)'
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
        <section className="py-24 lg:py-36 relative overflow-hidden">
            <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 70% at 50% 50%, rgba(13,148,136,0.12) 0%, transparent 70%), var(--bg-primary)' }} />
            <div ref={contentRef} className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                <h2 style={{ fontFamily: 'Crimson Pro, serif', fontSize: 'clamp(2.25rem, 5vw, 4rem)', fontWeight: 700, lineHeight: 1.1, color: 'var(--text-primary)' }} className="mb-6">
                    Ready to transform<br />
                    <span style={{ background: 'linear-gradient(135deg, #2dd4bf 0%, #0d9488 50%, #f59e0b 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                        your worship service?
                    </span>
                </h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', lineHeight: 1.8 }} className="mb-10 max-w-2xl mx-auto">
                    Join hundreds of churches already using Selah. Start free today — no credit card required.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                    <Link to="/signup" className="group flex items-center gap-2 px-8 py-4 font-semibold rounded-2xl text-white text-lg transition-all hover:opacity-90"
                        style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)', boxShadow: '0 8px 32px rgba(13,148,136,0.3)' }}>
                        Get Started Free
                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </Link>
                    <Link to="/login" className="flex items-center gap-2 px-8 py-4 font-semibold rounded-2xl text-lg transition-all hover:opacity-80"
                        style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-default)', background: 'var(--bg-secondary)' }}>
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
        <footer className="border-t py-12" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-secondary)' }}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)' }}>
                            <Music className="w-3.5 h-3.5 text-white" />
                        </div>
                        <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Selah</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginLeft: '0.5rem' }}>Worship Presentation Platform</span>
                    </div>
                    <div className="flex items-center gap-6">
                        <Link to="/login" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }} className="hover:text-primary-400 transition-colors">Sign In</Link>
                        <Link to="/signup" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }} className="hover:text-primary-400 transition-colors">Get Started</Link>
                        <a href="mailto:hello@selah.app" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }} className="hover:text-primary-400 transition-colors">Contact</a>
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        © {new Date().getFullYear()} Selah. Built for the Church.
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
        <div className="dark min-h-screen overflow-hidden" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
            <NavBar scrolled={scrolled} mobileMenuOpen={mobileMenuOpen} setMobileMenuOpen={setMobileMenuOpen} />
            <HeroSection />
            <SermonListenerSection activeTranscriptLine={activeTranscriptLine} detectedVerse={detectedVerse} />
            <CoreFeaturesSection />
            <DashboardSection />
            <TechHighlightsSection />
            <TestimonialsSection />
            <PricingSection />
            <CtaSection />
            <FooterSection />
        </div>
    )
}
