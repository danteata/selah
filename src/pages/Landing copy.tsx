import { Link } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { gsap } from '../lib/gsap'
import { useScrollReveal } from '../hooks/useScrollReveal'
import {
    BookOpen,
    Video,
    Clock,
    Bell,
    Monitor,
    Users,
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
    Music,
    Book,
    Type,
    Palette,
    Cast,
    Lock,
    MessageSquare,
    UserCheck,
    Radio,
    Sliders,
    Volume2,
} from 'lucide-react'

const coreFeatures = [
    {
        icon: Music,
        title: 'Song & Hymn Library',
        description: "Every song your church loves, organised and ready. Find anything in seconds during a live service.",
        accent: '#0d9488',
        tag: 'Core',
    },
    {
        icon: Book,
        title: 'Bible on Screen',
        description: 'Search any translation and display verses beautifully. Add your own Bible version and it works the same way.',
        accent: '#d97706',
        tag: 'Core',
    },
    {
        icon: Video,
        title: 'Media & Video',
        description: 'Play YouTube clips, show announcement videos, or display images, all from the same screen.',
        accent: '#be123c',
        tag: 'Core',
    },
    {
        icon: Clock,
        title: 'Countdown Timers',
        description: 'Keep people engaged before the service begins. Beautiful countdowns you can set up in seconds.',
        accent: '#059669',
        tag: 'Core',
    },
    {
        icon: Bell,
        title: 'Live Announcements',
        description: 'Need to share something mid-service? Push a message to the screen instantly, with no interruption.',
        accent: '#4338ca',
        tag: 'Core',
    },
    {
        icon: Monitor,
        title: 'Projection Output',
        description: 'Project to any connected screen with one click. Your congregation always sees the right content.',
        accent: '#0d9488',
        tag: 'Live',
    },
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
    { icon: Type, title: 'Rich Text Editor', description: 'Change fonts, colours, and layout on any slide. No design experience needed.' },
    { icon: Palette, title: 'Reusable Templates', description: 'Save your favourite slide designs and reuse them week after week with one click.' },
]

const collabModes = [
    { icon: Lock, label: 'Strict', desc: 'Operator only' },
    { icon: MessageSquare, label: 'Review', desc: 'Suggest → approve' },
    { icon: UserCheck, label: 'Open', desc: 'Anyone pushes' },
]

const transcriptDemo = [
    { text: '…and as we reflect on the love of God, we turn to', delay: 0 },
    { text: 'John chapter three, verse sixteen —', delay: 2200, isVerse: true },
    { text: 'where we read that God so loved the world', delay: 4400 },
    { text: 'that he gave his one and only Son…', delay: 6400 },
]

const waveBars = Array.from({ length: 32 }, (_, i) => {
    const base = 20 + Math.abs(Math.sin(i * 0.55)) * 75
    return Math.round(base)
})

function NavBar({
    scrolled,
    mobileMenuOpen,
    setMobileMenuOpen,
}: {
    scrolled: boolean
    mobileMenuOpen: boolean
    setMobileMenuOpen: (v: boolean) => void
}) {
    const navLinks = [
        { href: '#features', label: 'Features' },
        { href: '#ai-listener', label: 'AI Listener' },
        { href: '#dashboard', label: 'Dashboard' },
        { href: '#early-access', label: 'Early Access' },
    ]

    return (
        <nav
            className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 border-b ${scrolled
                    ? 'bg-[#08090c]/80 backdrop-blur-xl border-white/5 shadow-2xl shadow-black/20'
                    : 'bg-transparent border-transparent'
                }`}
        >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    <Link to="/" className="flex items-center gap-2.5 group">
                        <div
                            className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg transition-transform group-hover:scale-105"
                            style={{
                                background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                                boxShadow: '0 8px 24px -4px rgba(20,184,166,0.4), inset 0 1px 0 rgba(255,255,255,0.2)',
                            }}
                        >
                            <BookOpen className="w-4.5 h-4.5 text-white" strokeWidth={2.25} />
                        </div>
                        <div className="leading-none">
                            <div
                                style={{ fontFamily: 'Crimson Pro, serif', fontSize: '1.25rem', fontWeight: 600 }}
                                className="text-white"
                            >
                                Selah
                            </div>
                            <div
                                className="text-[9px] font-mono uppercase tracking-[0.22em] mt-0.5"
                                style={{ color: 'rgba(255,255,255,0.35)' }}
                            >
                                Worship Studio
                            </div>
                        </div>
                    </Link>

                    <div className="hidden md:flex items-center gap-1">
                        {navLinks.map((link) => (
                            <a
                                key={link.href}
                                href={link.href}
                                className="px-3 py-2 text-sm font-medium text-white/60 hover:text-white transition-colors rounded-lg hover:bg-white/5"
                            >
                                {link.label}
                            </a>
                        ))}
                    </div>

                    <div className="hidden md:flex items-center gap-3">
                        <Link
                            to="/download"
                            className="group flex items-center gap-1.5 text-sm font-medium text-white/70 hover:text-white transition-colors px-3 py-2"
                        >
                            Download
                        </Link>
                        <Link
                            to="/login"
                            className="text-sm font-medium text-white/60 hover:text-white transition-colors px-3 py-2"
                        >
                            Sign In
                        </Link>
                        <Link
                            to="/signup"
                            className="group flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl text-white transition-all hover:-translate-y-px"
                            style={{
                                background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                                boxShadow: '0 4px 16px -4px rgba(20,184,166,0.5), inset 0 1px 0 rgba(255,255,255,0.15)',
                            }}
                        >
                            Get Started Free
                            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                        </Link>
                    </div>

                    <button
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        className="md:hidden p-2 text-white/60 hover:text-white"
                    >
                        {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </button>
                </div>
            </div>

            {mobileMenuOpen && (
                <div className="md:hidden bg-[#08090c]/95 backdrop-blur-xl border-t border-white/5">
                    <div className="px-4 py-4 space-y-1">
                        {navLinks.map((link) => (
                            <a
                                key={link.href}
                                href={link.href}
                                onClick={() => setMobileMenuOpen(false)}
                                className="block py-2.5 px-3 text-sm text-white/70 hover:text-white hover:bg-white/5 rounded-lg"
                            >
                                {link.label}
                            </a>
                        ))}
                        <div className="pt-3 mt-3 border-t border-white/5 space-y-2">
                            <Link
                                to="/download"
                                onClick={() => setMobileMenuOpen(false)}
                                className="block py-2.5 px-3 text-sm text-white/70 hover:text-white rounded-lg"
                            >
                                Download
                            </Link>
                            <Link
                                to="/login"
                                className="block py-2.5 px-3 text-sm text-white/70 hover:text-white rounded-lg"
                            >
                                Sign In
                            </Link>
                            <Link
                                to="/signup"
                                className="block w-full py-3 text-center text-sm font-semibold rounded-xl text-white"
                                style={{ background: 'linear-gradient(135deg, #14b8a6, #0d9488)' }}
                            >
                                Get Started Free
                            </Link>
                        </div>
                    </div>
                </div>
            )}
        </nav>
    )
}

function HeroSection() {
    const heroRef = useRef<HTMLElement>(null)

    useEffect(() => {
        const el = heroRef.current
        if (!el) return
        const ctx = gsap.context(() => {
            gsap.set(
                [
                    '.hero-badge',
                    '.hero-line',
                    '.hero-subtitle',
                    '.hero-cta',
                    '.hero-stat',
                    '.hero-orb',
                ],
                { opacity: 0 }
            )
            const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
            tl.to('.hero-badge', { opacity: 1, y: 0, duration: 0.6, delay: 0.15 })
                .fromTo(
                    '.hero-line',
                    { opacity: 0, y: 44 },
                    { opacity: 1, y: 0, duration: 0.8, stagger: 0.14 },
                    '-=0.3'
                )
                .to('.hero-subtitle', { opacity: 1, y: 0, duration: 0.6 }, '-=0.3')
                .to('.hero-cta', { opacity: 1, y: 0, duration: 0.5, stagger: 0.08 }, '-=0.3')
                .to('.hero-stat', { opacity: 1, y: 0, duration: 0.45, stagger: 0.06 }, '-=0.25')
                .fromTo(
                    '.hero-mockup',
                    { y: 60, opacity: 0 },
                    { opacity: 1, y: 0, duration: 1, ease: 'power3.out' },
                    '-=0.8'
                )
                .fromTo(
                    '.hero-orb',
                    { scale: 0.6 },
                    { opacity: 0.8, scale: 1, duration: 1.4, ease: 'power2.out' },
                    '-=1.2'
                )
        }, el)
        return () => ctx.revert()
    }, [])

    return (
        <section
            ref={heroRef}
            className="relative pt-32 pb-20 lg:pt-40 lg:pb-28 overflow-hidden"
            style={{ background: '#08090c' }}
        >
            <div
                className="absolute inset-0 pointer-events-none animate-lp-gradient-drift"
                style={{
                    background:
                        'radial-gradient(ellipse 60% 50% at 25% 10%, rgba(20,184,166,0.18), transparent 60%),' +
                        'radial-gradient(ellipse 50% 50% at 80% 70%, rgba(217,119,6,0.10), transparent 65%),' +
                        'radial-gradient(ellipse 40% 40% at 50% 50%, rgba(45,212,191,0.05), transparent 60%)',
                }}
            />

            <div
                className="absolute inset-0 pointer-events-none opacity-[0.04]"
                style={{
                    backgroundImage:
                        'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
                    backgroundSize: '64px 64px',
                    maskImage: 'radial-gradient(ellipse 60% 60% at 50% 40%, black 30%, transparent 80%)',
                    WebkitMaskImage: 'radial-gradient(ellipse 60% 60% at 50% 40%, black 30%, transparent 80%)',
                }}
            />

            <div
                className="hero-orb absolute top-32 left-[12%] w-72 h-72 bg-primary-500/20 rounded-full blur-3xl pointer-events-none"
                style={{ animation: 'blob 9s infinite' }}
            />
            <div
                className="hero-orb absolute top-48 right-[10%] w-64 h-64 bg-amber-500/12 rounded-full blur-3xl pointer-events-none"
                style={{ animation: 'blob 11s infinite 2s' }}
            />
            <div
                className="hero-orb absolute bottom-40 left-1/3 w-56 h-56 bg-pink-500/10 rounded-full blur-3xl pointer-events-none"
                style={{ animation: 'blob 13s infinite 4s' }}
            />

            <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center max-w-4xl mx-auto">
                    <div
                        className="hero-badge inline-flex items-center gap-2 px-4 py-2 rounded-full mb-7"
                        style={{
                            background: 'linear-gradient(135deg, rgba(20,184,166,0.15) 0%, rgba(13,148,136,0.08) 100%)',
                            border: '1px solid rgba(20,184,166,0.35)',
                            boxShadow: '0 8px 24px -8px rgba(20,184,166,0.3), inset 0 1px 0 rgba(255,255,255,0.06)',
                        }}
                    >
                        <span className="relative flex w-1.5 h-1.5">
                            <span className="absolute inline-flex h-full w-full rounded-full bg-primary-400 opacity-75 animate-ping" />
                            <span className="relative inline-flex rounded-full w-1.5 h-1.5 bg-primary-400" />
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-primary-200">
                            Now in open beta · v2 ships this month
                        </span>
                    </div>

                    <h1
                        className="font-bold leading-[1.02] text-white mb-7 font-serif tracking-tight"
                        style={{ fontSize: 'clamp(2.75rem, 6.5vw, 5rem)', textShadow: '0 1px 0 rgba(0,0,0,0.4)' }}
                    >
                        <span className="hero-line block">Preach the sermon.</span>
                        <span
                            className="hero-line block italic"
                            style={{
                                background: 'linear-gradient(135deg, #5eead4 0%, #2dd4bf 45%, #fcd34d 100%)',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text',
                            }}
                        >
                            We&rsquo;ll find the verse.
                        </span>
                    </h1>

                    <p
                        className="hero-subtitle text-lg lg:text-xl max-w-2xl mx-auto mb-9 leading-relaxed"
                        style={{ color: 'rgba(228,228,231,0.75)' }}
                    >
                        Selah listens to your sermon, catches every scripture reference, and
                        puts the right verse on screen &mdash;{' '}
                        <span className="text-white font-medium">automatically, offline, in real time.</span>
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10">
                        <Link
                            to="/signup"
                            className="hero-cta group flex items-center gap-2 px-7 py-3.5 font-semibold rounded-2xl text-white transition-all hover:-translate-y-px"
                            style={{
                                background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                                boxShadow: '0 8px 32px -4px rgba(20,184,166,0.45), inset 0 1px 0 rgba(255,255,255,0.15)',
                            }}
                        >
                            Get My Church Started
                            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                        </Link>
                        <a
                            href="#ai-listener"
                            className="hero-cta flex items-center gap-2 px-5 py-3.5 font-medium rounded-2xl text-white/80 transition-all hover:text-white"
                            style={{
                                border: '1px solid rgba(255,255,255,0.1)',
                                background: 'rgba(255,255,255,0.03)',
                                backdropFilter: 'blur(10px)',
                            }}
                        >
                            <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
                            <span>Watch it work</span>
                            <span className="text-zinc-500 text-sm">90s</span>
                        </a>
                    </div>

                    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mb-4">
                        {[
                            'Free during beta',
                            'No credit card',
                            'Works fully offline',
                            'Under 30-min setup',
                        ].map((label) => (
                            <span
                                key={label}
                                className="hero-stat inline-flex items-center gap-1.5 text-[13px]"
                                style={{ color: 'rgba(228,228,231,0.55)' }}
                            >
                                <svg
                                    className="w-3.5 h-3.5 text-primary-400"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M5 13l4 4L19 7" />
                                </svg>
                                {label}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Floating product mockup — the actual app surface */}
                <div className="hero-mockup relative max-w-5xl mx-auto mt-12">
                    <div
                        className="relative rounded-2xl overflow-hidden"
                        style={{
                            background: 'linear-gradient(180deg, rgba(15,18,22,0.95) 0%, rgba(8,10,14,0.98) 100%)',
                            border: '1px solid rgba(255,255,255,0.10)',
                            boxShadow: '0 60px 120px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06)',
                        }}
                    >
                        {/* App chrome */}
                        <div
                            className="flex items-center gap-2 px-4 py-2.5 border-b"
                            style={{ borderColor: 'rgba(255,255,255,0.06)' }}
                        >
                            <div className="flex gap-1.5">
                                <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
                                <div className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
                            </div>
                            <div
                                className="ml-3 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.22em]"
                                style={{ color: 'rgba(255,255,255,0.45)' }}
                            >
                                <BookOpen className="w-3 h-3" /> selah.app
                            </div>
                            <div className="ml-auto flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.22em] text-emerald-400">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                Live · Sunday 10:42 AM
                            </div>
                        </div>

                        {/* App body */}
                        <div className="grid grid-cols-1 md:grid-cols-[180px_1fr_220px] min-h-[280px]">
                            {/* Left rail — service order */}
                            <div
                                className="p-3 md:border-r hidden md:block"
                                style={{
                                    borderColor: 'rgba(255,255,255,0.05)',
                                    background: 'rgba(0,0,0,0.2)',
                                }}
                            >
                                <div className="text-[9px] font-mono uppercase tracking-[0.22em] text-white/40 mb-2.5 px-1">
                                    Service order
                                </div>
                                {[
                                    { label: 'Welcome', done: true },
                                    { label: 'Worship · 3 songs', done: true },
                                    { label: 'Sermon', active: true },
                                    { label: 'Offering', done: false },
                                    { label: 'Communion', done: false },
                                    { label: 'Closing', done: false },
                                ].map((item) => (
                                    <div
                                        key={item.label}
                                        className="flex items-center gap-2 px-2 py-1.5 rounded-md mb-0.5 text-[11px]"
                                        style={
                                            item.active
                                                ? {
                                                      background: 'rgba(20,184,166,0.12)',
                                                      border: '1px solid rgba(20,184,166,0.3)',
                                                      color: '#5eead4',
                                                  }
                                                : {
                                                      color: item.done
                                                          ? 'rgba(255,255,255,0.45)'
                                                          : 'rgba(255,255,255,0.6)',
                                                  }
                                        }
                                    >
                                        <div
                                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                            style={{
                                                background: item.active
                                                    ? '#5eead4'
                                                    : item.done
                                                    ? 'rgba(20,184,166,0.4)'
                                                    : 'rgba(255,255,255,0.2)',
                                                boxShadow: item.active ? '0 0 8px #5eead4' : 'none',
                                            }}
                                        />
                                        <span className={item.done ? 'line-through decoration-white/20' : ''}>
                                            {item.label}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            {/* Center — projection preview */}
                            <div className="p-4 flex flex-col">
                                <div className="text-[9px] font-mono uppercase tracking-[0.22em] text-white/40 mb-2">
                                    On screen now
                                </div>
                                <div
                                    className="flex-1 rounded-lg flex flex-col items-center justify-center text-center px-4 relative overflow-hidden"
                                    style={{ background: 'linear-gradient(135deg, #042f2e 0%, #0c0a09 100%)' }}
                                >
                                    <div
                                        className="absolute inset-0 opacity-30"
                                        style={{
                                            background:
                                                'radial-gradient(circle at 30% 30%, rgba(20,184,166,0.3), transparent 60%)',
                                        }}
                                    />
                                    <div className="relative">
                                        <div className="text-[9px] font-mono uppercase tracking-[0.3em] text-teal-300/80 mb-2">
                                            John 3:16
                                        </div>
                                        <div
                                            className="text-white text-base sm:text-lg leading-snug"
                                            style={{ fontFamily: 'Crimson Pro, serif' }}
                                        >
                                            &ldquo;For God so loved the world
                                            <br />
                                            that he gave his one and only Son…&rdquo;
                                        </div>
                                        <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/30 mt-3">
                                            NIV · Pushed 2s ago
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Right — AI listener status */}
                            <div
                                className="p-3 md:border-l hidden md:block"
                                style={{
                                    borderColor: 'rgba(255,255,255,0.05)',
                                    background: 'rgba(0,0,0,0.2)',
                                }}
                            >
                                <div className="flex items-center justify-between mb-2.5 px-1">
                                    <div className="text-[9px] font-mono uppercase tracking-[0.22em] text-white/40">
                                        AI Listener
                                    </div>
                                    <div className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-[0.22em] text-emerald-400">
                                        <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                                        Live
                                    </div>
                                </div>
                                <div className="flex items-end gap-[2px] h-7 mb-3">
                                    {Array.from({ length: 24 }).map((_, i) => (
                                        <span
                                            key={i}
                                            className="flex-1 rounded-full"
                                            style={{
                                                background: 'linear-gradient(180deg, #5eead4 0%, #0d9488 100%)',
                                                height: `${30 + Math.abs(Math.sin(i * 0.6)) * 70}%`,
                                                animation: `waveform-bar 1.1s ease-in-out ${i * 0.04}s infinite`,
                                                opacity: 0.75,
                                            }}
                                        />
                                    ))}
                                </div>
                                <div
                                    className="rounded-md p-2 mb-2"
                                    style={{
                                        background: 'rgba(20,184,166,0.08)',
                                        border: '1px solid rgba(20,184,166,0.25)',
                                    }}
                                >
                                    <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-teal-300 mb-0.5">
                                        Just detected
                                    </div>
                                    <div className="text-[11px] text-white font-medium">John 3:16</div>
                                </div>
                                <div
                                    className="rounded-md p-2"
                                    style={{
                                        background: 'rgba(255,255,255,0.03)',
                                        border: '1px solid rgba(255,255,255,0.06)',
                                    }}
                                >
                                    <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/40 mb-0.5">
                                        Queue
                                    </div>
                                    <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                                        Romans 6:23 · Romans 5:8
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Floating annotation chips */}
                    <div
                        className="hidden lg:flex absolute -left-6 top-1/4 items-center gap-2 px-3 py-2 rounded-xl text-xs whitespace-nowrap"
                        style={{
                            background: 'rgba(15,18,22,0.95)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            boxShadow: '0 10px 30px -10px rgba(0,0,0,0.5)',
                        }}
                    >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        <span style={{ color: 'rgba(255,255,255,0.85)' }}>Caught it the moment you said it</span>
                    </div>
                    <div
                        className="hidden lg:flex absolute -right-6 bottom-12 items-center gap-2 px-3 py-2 rounded-xl text-xs whitespace-nowrap"
                        style={{
                            background: 'rgba(15,18,22,0.95)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            boxShadow: '0 10px 30px -10px rgba(0,0,0,0.5)',
                        }}
                    >
                        <svg
                            className="w-3.5 h-3.5 text-teal-400"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M5 13l4 4L19 7" />
                        </svg>
                        <span style={{ color: 'rgba(255,255,255,0.85)' }}>Pushed to every screen instantly</span>
                    </div>
                </div>
            </div>
        </section>
    )
}

function LiveDemoMock({
    activeLine,
    showDetected,
}: {
    activeLine: number
    showDetected: boolean
}) {
    return (
        <div
            className="rounded-2xl overflow-hidden flex flex-col animate-lp-mock-float"
            style={{
                height: '420px',
                background: 'linear-gradient(180deg, rgba(15,18,22,0.9) 0%, rgba(8,10,14,0.96) 100%)',
                border: '1px solid rgba(255,255,255,0.08)',
                boxShadow:
                    '0 40px 80px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 80px -20px rgba(20,184,166,0.2)',
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
                    <Mic className="w-3.5 h-3.5 text-primary-400" />
                    <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-white/50">
                        Sermon Listener
                    </span>
                </div>
                <span className="ml-auto flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.22em] text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-live-dot" />
                    Live
                </span>
            </div>

            <div className="flex-1 p-6 pb-5 flex flex-col gap-5 overflow-hidden min-h-0">
                <div className="flex items-center gap-1 h-10 flex-shrink-0">
                    {waveBars.map((h, i) => (
                        <div
                            key={i}
                            className="flex-1 rounded-full"
                            style={{
                                background: 'linear-gradient(180deg, #2dd4bf 0%, #0d9488 100%)',
                                animation: `waveform-bar 1.2s ease-in-out ${i * 0.04}s infinite`,
                                opacity: 0.75,
                                minHeight: '4px',
                                maxHeight: `${h}%`,
                            }}
                        />
                    ))}
                </div>

                <div className="flex-1 overflow-hidden flex flex-col justify-end gap-2.5 min-h-0">
                    {transcriptDemo.map((line, i) => (
                        <p
                            key={i}
                            className="text-[15px] leading-relaxed transition-all duration-500"
                            style={{
                                opacity: i <= activeLine ? 1 : 0,
                                color:
                                    line.isVerse && i === activeLine
                                        ? '#5eead4'
                                        : 'rgb(228,228,231)',
                                fontWeight: line.isVerse && i === activeLine ? 600 : 400,
                            }}
                        >
                            {line.text}
                            {line.isVerse && i <= activeLine && (
                                <span
                                    className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-widest"
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
                    className="h-full p-4 rounded-xl"
                    style={{
                        background: 'linear-gradient(135deg, rgba(20,184,166,0.20) 0%, rgba(20,184,166,0.04) 100%)',
                        border: '1px solid rgba(20,184,166,0.32)',
                        boxShadow: '0 8px 24px -8px rgba(20,184,166,0.25)',
                        opacity: showDetected ? 1 : 0,
                        transform: showDetected ? 'translateX(0)' : 'translateX(-10px)',
                        transition: 'opacity 0.5s ease, transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                >
                    <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.22em] text-primary-300 mb-1.5">
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
                        &ldquo;For God so loved the world that he gave his one and only
                        Son…&rdquo;
                    </div>
                </div>
            </div>
        </div>
    )
}

function SermonListenerSection({
    activeLine,
    showDetected,
}: {
    activeLine: number
    showDetected: boolean
}) {
    const colLeftRef = useScrollReveal<HTMLDivElement>('fade-right', { start: 'top 82%' })
    const colRightRef = useScrollReveal<HTMLDivElement>('scale', { start: 'top 82%', delay: 0.15 })

    return (
        <section id="ai-listener" className="relative py-24 lg:py-36 overflow-hidden" style={{ background: '#08090c' }}>
            <div
                className="absolute inset-0 pointer-events-none opacity-40"
                style={{
                    background:
                        'radial-gradient(ellipse 50% 50% at 20% 30%, rgba(20,184,166,0.10), transparent 60%),' +
                        'radial-gradient(ellipse 40% 40% at 85% 70%, rgba(217,119,6,0.06), transparent 60%)',
                }}
            />

            <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid lg:grid-cols-2 gap-16 items-center">
                    <div ref={colLeftRef}>
                        <div
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6 text-[10px] font-bold uppercase tracking-[0.22em]"
                            style={{
                                background: 'linear-gradient(135deg, rgba(20,184,166,0.15) 0%, rgba(13,148,136,0.08) 100%)',
                                border: '1px solid rgba(20,184,166,0.35)',
                                color: '#5eead4',
                            }}
                        >
                            <Mic className="w-3 h-3" /> AI Sermon Listener
                        </div>
                        <h2
                            className="mb-5 font-serif tracking-tight"
                            style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: 700, lineHeight: 1.1, color: '#fff' }}
                        >
                            Scripture surfaces itself.
                            <br />
                            <span
                                style={{
                                    background: 'linear-gradient(135deg, #5eead4 0%, #2dd4bf 45%, #fcd34d 100%)',
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent',
                                    backgroundClip: 'text',
                                }}
                                className="italic"
                            >
                                You just preach.
                            </span>
                        </h2>
                        <p
                            className="mb-8 leading-relaxed text-lg"
                            style={{ color: 'rgba(228,228,231,0.7)' }}
                        >
                            Selah listens quietly in the background as your pastor preaches. The
                            moment a scripture is mentioned, or even just implied, the right
                            verse is ready to appear on screen. No scrambling, no missed
                            moments.
                        </p>
                        <div className="space-y-3.5">
                            {aiFeatures.map((f) => (
                                <div
                                    key={f.title}
                                    className="flex gap-4 p-4 rounded-2xl transition-all hover:bg-white/[0.02]"
                                    style={{
                                        background: 'rgba(255,255,255,0.02)',
                                        border: '1px solid rgba(255,255,255,0.06)',
                                    }}
                                >
                                    <div
                                        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                                        style={{
                                            background: 'rgba(20,184,166,0.12)',
                                            border: '1px solid rgba(20,184,166,0.2)',
                                        }}
                                    >
                                        <f.icon className="w-4 h-4 text-primary-300" />
                                    </div>
                                    <div>
                                        <div className="font-semibold text-white text-[0.95rem]">{f.title}</div>
                                        <div
                                            className="mt-1 leading-relaxed"
                                            style={{ color: 'rgba(228,228,231,0.6)', fontSize: '0.85rem' }}
                                        >
                                            {f.description}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div ref={colRightRef}>
                        <LiveDemoMock activeLine={activeLine} showDetected={showDetected} />
                    </div>
                </div>
            </div>
        </section>
    )
}

function CoreFeaturesSection() {
    const headingRef = useScrollReveal<HTMLDivElement>('fade-up', { start: 'top 88%' })
    const gridRef = useScrollReveal<HTMLDivElement>('stagger', { start: 'top 85%', staggerAmount: 0.08 })

    return (
        <section
            id="features"
            className="relative py-24 lg:py-36 overflow-hidden"
            style={{ background: '#0a0b10' }}
        >
            <div
                className="absolute inset-0 pointer-events-none opacity-30"
                style={{
                    background:
                        'radial-gradient(ellipse 50% 50% at 80% 20%, rgba(20,184,166,0.08), transparent 60%)',
                }}
            />

            <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div ref={headingRef} className="text-center mb-16">
                    <div
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5 text-[10px] font-bold uppercase tracking-[0.22em]"
                        style={{
                            background: 'linear-gradient(135deg, rgba(20,184,166,0.15) 0%, rgba(13,148,136,0.08) 100%)',
                            border: '1px solid rgba(20,184,166,0.35)',
                            color: '#5eead4',
                        }}
                    >
                        <Sparkles className="w-3 h-3" /> Everything you need
                    </div>
                    <h2
                        className="text-4xl sm:text-5xl font-bold text-white mb-4 font-serif tracking-tight"
                    >
                        Built for the whole service
                    </h2>
                    <p className="text-lg max-w-2xl mx-auto" style={{ color: 'rgba(228,228,231,0.6)' }}>
                        Songs, scripture, media, countdowns, announcements. All in one unified
                        platform built for live services.
                    </p>
                </div>

                <div ref={gridRef} className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {coreFeatures.map((f) => (
                        <div
                            key={f.title}
                            className="group relative rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1"
                            style={{
                                background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
                                border: '1px solid rgba(255,255,255,0.06)',
                                backdropFilter: 'blur(10px)',
                            }}
                        >
                            <div
                                className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                                style={{
                                    background: `radial-gradient(circle at 50% 0%, ${f.accent}15, transparent 60%)`,
                                }}
                            />
                            <div className="relative">
                                <div className="flex items-start justify-between mb-4">
                                    <div
                                        className="w-11 h-11 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300"
                                        style={{
                                            background: `${f.accent}15`,
                                            border: `1px solid ${f.accent}25`,
                                        }}
                                    >
                                        <f.icon className="w-5 h-5" style={{ color: f.accent }} />
                                    </div>
                                    <span
                                        className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest"
                                        style={{ background: `${f.accent}15`, color: f.accent }}
                                    >
                                        {f.tag}
                                    </span>
                                </div>
                                <h3 className="text-lg font-semibold text-white mb-2">{f.title}</h3>
                                <p
                                    className="text-sm leading-relaxed"
                                    style={{ color: 'rgba(228,228,231,0.6)' }}
                                >
                                    {f.description}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}

function DashboardSection() {
    const colLeftRef = useScrollReveal<HTMLDivElement>('fade-right', { start: 'top 82%' })
    const colRightRef = useScrollReveal<HTMLDivElement>('scale', { start: 'top 82%', delay: 0.15 })

    const panels = [
        { label: 'Quick Actions', col: 'col-span-1', h: 'row-span-2', accent: '#0d9488' },
        { label: 'Live Preview', col: 'col-span-2', h: '', accent: '#be123c' },
        { label: 'Service Order', col: 'col-span-2', h: '', accent: '#4338ca' },
        { label: 'AI Listener', col: 'col-span-2', h: '', accent: '#0d9488' },
        { label: 'Library', col: 'col-span-1', h: 'row-span-2', accent: '#d97706' },
    ]

    return (
        <section
            id="dashboard"
            className="relative py-24 lg:py-36 overflow-hidden"
            style={{ background: '#08090c' }}
        >
            <div
                className="absolute inset-0 pointer-events-none opacity-40"
                style={{
                    background:
                        'radial-gradient(ellipse 55% 55% at 80% 50%, rgba(217,119,6,0.08), transparent 65%)',
                }}
            />

            <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid lg:grid-cols-2 gap-16 items-center">
                    <div ref={colLeftRef}>
                        <div
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6 text-[10px] font-bold uppercase tracking-[0.22em]"
                            style={{
                                background: 'linear-gradient(135deg, rgba(217,119,6,0.15) 0%, rgba(180,83,9,0.08) 100%)',
                                border: '1px solid rgba(217,119,6,0.35)',
                                color: '#fcd34d',
                            }}
                        >
                            <LayoutDashboard className="w-3 h-3" /> Adaptive Dashboard
                        </div>
                        <h2
                            className="mb-5 font-serif tracking-tight"
                            style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: 700, lineHeight: 1.1, color: '#fff' }}
                        >
                            Your layout,
                            <br />
                            <span
                                style={{
                                    background: 'linear-gradient(135deg, #fcd34d 0%, #f59e0b 100%)',
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent',
                                    backgroundClip: 'text',
                                }}
                                className="italic"
                            >
                                your way.
                            </span>
                        </h2>
                        <p
                            className="mb-8 leading-relaxed text-lg"
                            style={{ color: 'rgba(228,228,231,0.7)' }}
                        >
                            Selah's drag-and-drop dashboard adapts to every volunteer's
                            workflow. Resize and reposition every panel. Your layout is saved
                            per user, per church.
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                            {dashboardFeatures.map((f) => (
                                <div
                                    key={f.title}
                                    className="p-4 rounded-2xl"
                                    style={{
                                        background: 'rgba(255,255,255,0.02)',
                                        border: '1px solid rgba(255,255,255,0.06)',
                                    }}
                                >
                                    <div
                                        className="w-8 h-8 rounded-xl flex items-center justify-center mb-3"
                                        style={{
                                            background: 'rgba(217,119,6,0.12)',
                                            border: '1px solid rgba(217,119,6,0.2)',
                                        }}
                                    >
                                        <f.icon className="w-4 h-4 text-amber-400" />
                                    </div>
                                    <div className="font-semibold text-white text-[0.88rem]">
                                        {f.title}
                                    </div>
                                    <div
                                        className="mt-1 leading-relaxed"
                                        style={{ color: 'rgba(228,228,231,0.55)', fontSize: '0.78rem' }}
                                    >
                                        {f.description}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div
                        ref={colRightRef}
                        className="rounded-2xl overflow-hidden"
                        style={{
                            background: 'linear-gradient(180deg, rgba(15,18,22,0.9) 0%, rgba(8,10,14,0.96) 100%)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            boxShadow:
                                '0 40px 80px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.05)',
                        }}
                    >
                        <div
                            className="flex items-center gap-2 px-4 py-3 border-b"
                            style={{ borderColor: 'rgba(255,255,255,0.06)' }}
                        >
                            <div className="flex gap-1.5">
                                <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
                                <div className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
                            </div>
                            <span className="ml-2 text-[10px] font-mono uppercase tracking-[0.22em] text-white/50">
                                Selah Dashboard
                            </span>
                            <span className="ml-auto flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.22em] text-emerald-400">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-live-dot" />
                                Live
                            </span>
                        </div>
                        <div
                            className="p-4 grid grid-cols-3 gap-2 text-xs"
                            style={{ minHeight: '360px' }}
                        >
                            {panels.map((p) => (
                                <div
                                    key={p.label}
                                    className={`${p.col} ${p.h} flex items-center justify-center rounded-xl p-3 font-semibold relative overflow-hidden`}
                                    style={{
                                        background: `linear-gradient(135deg, ${p.accent}18 0%, ${p.accent}08 100%)`,
                                        border: `1px solid ${p.accent}30`,
                                        color: p.accent,
                                        minHeight: '68px',
                                    }}
                                >
                                    <span className="relative z-10">{p.label}</span>
                                    {p.label === 'AI Listener' && (
                                        <div
                                            className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-transparent via-primary-400/60 to-transparent"
                                            style={{ animation: 'lp-shimmer 3s linear infinite' }}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}

function StandoutFeaturesSection() {
    const headingRef = useScrollReveal<HTMLDivElement>('fade-up', { start: 'top 88%' })
    const gridRef = useScrollReveal<HTMLDivElement>('stagger', { start: 'top 85%', staggerAmount: 0.1 })

    const avatarColors = [
        'from-teal-400 to-emerald-500',
        'from-amber-400 to-orange-500',
        'from-rose-400 to-pink-500',
        'from-violet-400 to-purple-500',
    ]

    const pipelineBars = Array.from({ length: 40 }, (_, i) => {
        const base = 25 + Math.abs(Math.sin(i * 0.4)) * 60
        return Math.round(base)
    })

    const suggestedSlides = [
        { label: 'Amazing Grace (V2)', color: '#f59e0b' },
        { label: 'John 3:16', color: '#0d9488' },
        { label: 'Offering slide', color: '#be123c' },
    ]

    return (
        <section
            className="relative py-24 lg:py-36 overflow-hidden"
            style={{ background: '#0a0b10' }}
        >
            <div
                className="absolute inset-0 pointer-events-none opacity-50"
                style={{
                    background:
                        'radial-gradient(ellipse 50% 50% at 30% 30%, rgba(20,184,166,0.08), transparent 60%),' +
                        'radial-gradient(ellipse 40% 40% at 75% 70%, rgba(168,85,247,0.06), transparent 60%)',
                }}
            />

            <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div ref={headingRef} className="text-center mb-16 max-w-3xl mx-auto">
                    <div
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5 text-[10px] font-bold uppercase tracking-[0.22em]"
                        style={{
                            background:
                                'linear-gradient(135deg, rgba(168,85,247,0.15) 0%, rgba(20,184,166,0.08) 100%)',
                            border: '1px solid rgba(168,85,247,0.35)',
                            color: '#c4b5fd',
                        }}
                    >
                        <Sparkles className="w-3 h-3" /> Beyond the basics
                    </div>
                    <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4 font-serif tracking-tight">
                        Your whole media team, in sync
                    </h2>
                    <p
                        className="text-lg max-w-2xl mx-auto"
                        style={{ color: 'rgba(228,228,231,0.6)' }}
                    >
                        Features your volunteers will actually thank you for. Built for
                        the realities of running a service with a team — not just a
                        single operator at a desk.
                    </p>
                </div>

                <div ref={gridRef} className="grid lg:grid-cols-3 gap-5">
                    <div
                        className="group relative rounded-2xl p-6 overflow-hidden transition-all duration-300 hover:-translate-y-1"
                        style={{
                            background:
                                'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            backdropFilter: 'blur(10px)',
                        }}
                    >
                        <div
                            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                            style={{
                                background:
                                    'radial-gradient(circle at 50% 0%, rgba(20,184,166,0.12), transparent 60%)',
                            }}
                        />
                        <div className="relative">
                            <div
                                className="rounded-xl p-4 mb-5"
                                style={{
                                    background: 'rgba(8,10,14,0.6)',
                                    border: '1px solid rgba(255,255,255,0.06)',
                                }}
                            >
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-live-dot" />
                                        <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/50">
                                            Live Session
                                        </span>
                                    </div>
                                    <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-emerald-400">
                                        5 online
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="flex -space-x-2">
                                        {avatarColors.map((grad, i) => (
                                            <div
                                                key={i}
                                                className="w-7 h-7 rounded-full border-2 overflow-hidden"
                                                style={{ borderColor: '#0a0b10' }}
                                            >
                                                <div className={`w-full h-full bg-gradient-to-br ${grad}`} />
                                            </div>
                                        ))}
                                    </div>
                                    <span className="text-[10px] text-white/40 font-medium">
                                        Pastor, Sarah, James, +2
                                    </span>
                                </div>
                                <div className="space-y-1.5">
                                    {suggestedSlides.map((slide) => (
                                        <div
                                            key={slide.label}
                                            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
                                            style={{
                                                background: 'rgba(255,255,255,0.03)',
                                                border: '1px solid rgba(255,255,255,0.04)',
                                            }}
                                        >
                                            <div
                                                className="w-1.5 h-1.5 rounded-full"
                                                style={{ background: slide.color }}
                                            />
                                            <span className="text-[10px] text-white/70 flex-1 truncate">
                                                {slide.label}
                                            </span>
                                            <span className="text-[9px] text-white/30 font-mono uppercase">
                                                pending
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest mb-3"
                                style={{
                                    background: 'rgba(20,184,166,0.12)',
                                    color: '#5eead4',
                                }}
                            >
                                <Users className="w-2.5 h-2.5" /> Real-time
                            </div>
                            <h3 className="text-xl font-semibold text-white mb-2 font-serif">
                                Multi-user collaboration
                            </h3>
                            <p
                                className="text-sm leading-relaxed mb-4"
                                style={{ color: 'rgba(228,228,231,0.6)' }}
                            >
                                Your whole team works the service together. See who's
                                online, suggest slides from anywhere, and hand off
                                operator control with one click.
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {collabModes.map((mode) => (
                                    <div
                                        key={mode.label}
                                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px]"
                                        style={{
                                            background: 'rgba(255,255,255,0.03)',
                                            border: '1px solid rgba(255,255,255,0.06)',
                                            color: 'rgba(228,228,231,0.7)',
                                        }}
                                    >
                                        <mode.icon className="w-2.5 h-2.5 text-primary-400" />
                                        <span className="font-medium">{mode.label}</span>
                                        <span style={{ color: 'rgba(255,255,255,0.35)' }}>
                                            · {mode.desc}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div
                        className="group relative rounded-2xl p-6 overflow-hidden transition-all duration-300 hover:-translate-y-1"
                        style={{
                            background:
                                'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            backdropFilter: 'blur(10px)',
                        }}
                    >
                        <div
                            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                            style={{
                                background:
                                    'radial-gradient(circle at 50% 0%, rgba(168,85,247,0.12), transparent 60%)',
                            }}
                        />
                        <div className="relative">
                            <div
                                className="rounded-xl p-4 mb-5"
                                style={{
                                    background: 'rgba(8,10,14,0.6)',
                                    border: '1px solid rgba(255,255,255,0.06)',
                                }}
                            >
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-1.5">
                                        <Radio className="w-3 h-3 text-cyan-400" />
                                        <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/50">
                                            Audio Pipeline
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-live-dot" />
                                        <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-cyan-400">
                                            Desktop
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 h-8 mb-3">
                                    {pipelineBars.map((h, i) => (
                                        <div
                                            key={i}
                                            className="flex-1 rounded-full"
                                            style={{
                                                background:
                                                    'linear-gradient(180deg, #22d3ee 0%, #0e7490 100%)',
                                                animation: `waveform-bar 1.1s ease-in-out ${
                                                    i * 0.035
                                                }s infinite`,
                                                opacity: 0.8,
                                                minHeight: '3px',
                                                maxHeight: `${h}%`,
                                            }}
                                        />
                                    ))}
                                </div>
                                <div className="flex items-center justify-center gap-2 mb-3">
                                    <div
                                        className="flex items-center gap-1 px-2 py-1 rounded-md"
                                        style={{
                                            background: 'rgba(34,211,238,0.08)',
                                            border: '1px solid rgba(34,211,238,0.18)',
                                        }}
                                    >
                                        <Mic className="w-2.5 h-2.5 text-cyan-400" />
                                        <span className="text-[8px] font-mono uppercase tracking-widest text-cyan-300">
                                            Mic
                                        </span>
                                    </div>
                                    <div
                                        className="flex items-center gap-1 px-2 py-1 rounded-md"
                                        style={{
                                            background: 'rgba(34,211,238,0.08)',
                                            border: '1px solid rgba(34,211,238,0.18)',
                                        }}
                                    >
                                        <Sliders className="w-2.5 h-2.5 text-cyan-400" />
                                        <span className="text-[8px] font-mono uppercase tracking-widest text-cyan-300">
                                            Mixer
                                        </span>
                                    </div>
                                    <div
                                        className="flex items-center gap-1 px-2 py-1 rounded-md"
                                        style={{
                                            background: 'rgba(34,211,238,0.08)',
                                            border: '1px solid rgba(34,211,238,0.18)',
                                        }}
                                    >
                                        <Volume2 className="w-2.5 h-2.5 text-cyan-400" />
                                        <span className="text-[8px] font-mono uppercase tracking-widest text-cyan-300">
                                            Any app
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <div
                                        className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-md"
                                        style={{
                                            background: 'rgba(34,211,238,0.10)',
                                            border: '1px solid rgba(34,211,238,0.2)',
                                        }}
                                    >
                                        <Sliders className="w-3 h-3 text-cyan-400" />
                                        <span className="text-[9px] font-mono uppercase tracking-widest text-cyan-300">
                                            Any audio
                                        </span>
                                    </div>
                                    <svg
                                        className="w-3 h-3 text-white/20 flex-shrink-0"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                    >
                                        <path
                                            d="M5 12h14M13 5l7 7-7 7"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                    </svg>
                                    <div
                                        className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-md"
                                        style={{
                                            background: 'rgba(168,85,247,0.12)',
                                            border: '1px solid rgba(168,85,247,0.25)',
                                        }}
                                    >
                                        <Sparkles className="w-3 h-3 text-violet-400" />
                                        <span className="text-[9px] font-mono uppercase tracking-widest text-violet-300">
                                            Just speech
                                        </span>
                                    </div>
                                    <svg
                                        className="w-3 h-3 text-white/20 flex-shrink-0"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                    >
                                        <path
                                            d="M5 12h14M13 5l7 7-7 7"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                    </svg>
                                    <div
                                        className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-md"
                                        style={{
                                            background: 'rgba(20,184,166,0.12)',
                                            border: '1px solid rgba(20,184,166,0.25)',
                                        }}
                                    >
                                        <Type className="w-3 h-3 text-primary-400" />
                                        <span className="text-[9px] font-mono uppercase tracking-widest text-primary-300">
                                            Perfect text
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest mb-3"
                                style={{
                                    background: 'rgba(168,85,247,0.12)',
                                    color: '#c4b5fd',
                                }}
                            >
                                <Volume2 className="w-2.5 h-2.5" /> Desktop-only
                            </div>
                            <h3 className="text-xl font-semibold text-white mb-2 font-serif">
                                Captures any audio on your computer
                            </h3>
                            <p
                                className="text-sm leading-relaxed"
                                style={{ color: 'rgba(228,228,231,0.6)' }}
                            >
                                Plug in a mic, route your mixer, or play audio from
                                any app — a video, a DAW, a streaming service.
                                Selah captures any sermon source on your computer and
                                turns it into perfectly accurate text.
                            </p>
                        </div>
                    </div>

                    <div
                        className="group relative rounded-2xl p-6 overflow-hidden transition-all duration-300 hover:-translate-y-1"
                        style={{
                            background:
                                'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            backdropFilter: 'blur(10px)',
                        }}
                    >
                        <div
                            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                            style={{
                                background:
                                    'radial-gradient(circle at 50% 0%, rgba(59,130,246,0.12), transparent 60%)',
                            }}
                        />
                        <div className="relative">
                            <div
                                className="rounded-xl p-4 mb-5"
                                style={{
                                    background: 'rgba(8,10,14,0.6)',
                                    border: '1px solid rgba(255,255,255,0.06)',
                                }}
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-1.5">
                                        <Cast className="w-3 h-3 text-blue-400" />
                                        <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/50">
                                            Output
                                        </span>
                                    </div>
                                    <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-blue-400">
                                        NDI ready
                                    </span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex flex-col items-center gap-1">
                                        <div
                                            className="w-10 h-8 rounded-md flex items-center justify-center"
                                            style={{
                                                background:
                                                    'linear-gradient(135deg, rgba(59,130,246,0.25), rgba(59,130,246,0.1))',
                                                border: '1px solid rgba(59,130,246,0.4)',
                                            }}
                                        >
                                            <Monitor className="w-4 h-4 text-blue-300" />
                                        </div>
                                        <span className="text-[8px] font-mono uppercase tracking-widest text-white/50">
                                            Selah
                                        </span>
                                    </div>
                                    <div className="flex-1 relative h-8 flex items-center justify-center">
                                        <svg
                                            className="absolute inset-0 w-full h-full"
                                            viewBox="0 0 100 32"
                                            preserveAspectRatio="none"
                                        >
                                            <line
                                                x1="0"
                                                y1="16"
                                                x2="100"
                                                y2="16"
                                                stroke="rgba(59,130,246,0.35)"
                                                strokeWidth="1"
                                                strokeDasharray="2 3"
                                            />
                                        </svg>
                                        <div className="flex gap-1 relative z-10">
                                            <div className="w-1.5 h-1.5 rounded-full bg-blue-400/70" />
                                            <div className="w-1.5 h-1.5 rounded-full bg-blue-400/40" />
                                            <div className="w-1.5 h-1.5 rounded-full bg-blue-400/40" />
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <div className="flex gap-1">
                                            <div
                                                className="w-7 h-5 rounded-sm flex items-center justify-center"
                                                style={{
                                                    background: 'rgba(255,255,255,0.04)',
                                                    border: '1px solid rgba(255,255,255,0.12)',
                                                }}
                                            >
                                                <Monitor className="w-2.5 h-2.5 text-white/40" />
                                            </div>
                                            <div
                                                className="w-7 h-5 rounded-sm flex items-center justify-center"
                                                style={{
                                                    background: 'rgba(255,255,255,0.04)',
                                                    border: '1px solid rgba(255,255,255,0.12)',
                                                }}
                                            >
                                                <Monitor className="w-2.5 h-2.5 text-white/40" />
                                            </div>
                                        </div>
                                        <div
                                            className="w-[60px] h-5 rounded-sm flex items-center justify-center gap-1"
                                            style={{
                                                background:
                                                    'linear-gradient(135deg, rgba(59,130,246,0.2), rgba(59,130,246,0.08))',
                                                border: '1px solid rgba(59,130,246,0.3)',
                                            }}
                                        >
                                            <Cast className="w-2.5 h-2.5 text-blue-300" />
                                            <span className="text-[8px] font-mono uppercase tracking-widest text-blue-300">
                                                NDI
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest mb-3"
                                style={{
                                    background: 'rgba(59,130,246,0.12)',
                                    color: '#93c5fd',
                                }}
                            >
                                <Cast className="w-2.5 h-2.5" /> Pro output
                            </div>
                            <h3 className="text-xl font-semibold text-white mb-2 font-serif">
                                NDI + multi-monitor
                            </h3>
                            <p
                                className="text-sm leading-relaxed"
                                style={{ color: 'rgba(228,228,231,0.6)' }}
                            >
                                Stream to any screen, projector, or NDI receiver on your
                                network. Professional-grade video distribution for
                                sanctuaries of any size — no extra hardware required.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}

const betaPerks = [
    { title: 'Free during beta', description: 'Full access at no cost while we build together.' },
    { title: 'Direct line to the team', description: 'Your feedback lands in our build queue, not a support ticket.' },
    { title: 'Locked-in early-bird pricing', description: '50% off your plan for life when we officially launch.' },
    { title: 'Onboard with us, not a tutorial', description: 'We will personally help your first service go live.' },
]

function EarlyAccessSection() {
    const sectionRef = useScrollReveal<HTMLElement>('fade-up', { start: 'top 88%' })

    return (
        <section
            ref={sectionRef}
            id="early-access"
            className="relative py-24 lg:py-36 overflow-hidden"
            style={{ background: '#0a0b10' }}
        >
            <div
                className="absolute inset-0 pointer-events-none opacity-40"
                style={{
                    background:
                        'radial-gradient(ellipse 50% 50% at 50% 50%, rgba(20,184,166,0.10), transparent 60%)',
                }}
            />

            <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                <div
                    className="rounded-3xl p-10 md:p-16 text-center"
                    style={{
                        background: 'linear-gradient(180deg, rgba(20,184,166,0.06) 0%, rgba(255,255,255,0.02) 100%)',
                        border: '1px solid rgba(20,184,166,0.25)',
                        boxShadow: '0 40px 80px -20px rgba(0,0,0,0.5), 0 0 80px -20px rgba(20,184,166,0.2)',
                    }}
                >
                    <div
                        className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-6 text-[10px] font-bold uppercase tracking-[0.22em]"
                        style={{
                            background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                            boxShadow: '0 8px 24px -8px rgba(20,184,166,0.4)',
                            color: '#fff',
                        }}
                    >
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                        Open beta
                    </div>
                    <h2
                        className="text-4xl md:text-5xl font-bold text-white mb-5 leading-tight font-serif tracking-tight"
                    >
                        Try Selah on your next service.
                    </h2>
                    <p
                        className="text-lg mb-10 max-w-2xl mx-auto leading-relaxed"
                        style={{ color: 'rgba(228,228,231,0.7)' }}
                    >
                        Free while we&rsquo;re in beta. Set it up once, run it on Sunday, and tell
                        us what to build next. No sales call, no commitment.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-10 text-left">
                        {betaPerks.map((perk) => (
                            <div key={perk.title} className="flex items-start gap-4">
                                <div
                                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                                    style={{
                                        background: 'rgba(20,184,166,0.12)',
                                        border: '1px solid rgba(20,184,166,0.25)',
                                    }}
                                >
                                    <Check className="w-4 h-4 text-primary-400" />
                                </div>
                                <div>
                                    <div className="font-semibold text-white mb-0.5">{perk.title}</div>
                                    <div
                                        className="text-sm"
                                        style={{ color: 'rgba(228,228,231,0.6)' }}
                                    >
                                        {perk.description}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <Link
                        to="/signup"
                        className="group inline-flex items-center gap-2 px-8 py-4 font-semibold rounded-2xl text-white text-lg transition-all hover:-translate-y-px"
                        style={{
                            background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                            boxShadow: '0 8px 32px -4px rgba(20,184,166,0.45), inset 0 1px 0 rgba(255,255,255,0.15)',
                        }}
                    >
                        Get Started Free
                        <ArrowRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                    </Link>
                    <p
                        className="mt-5 text-sm italic"
                        style={{ color: 'rgba(228,228,231,0.4)' }}
                    >
                        No credit card · Cancel anytime
                    </p>
                </div>
            </div>
        </section>
    )
}

function CtaSection() {
    const contentRef = useScrollReveal<HTMLDivElement>('fade-up', { start: 'top 88%' })

    return (
        <section
            className="relative py-24 lg:py-36 overflow-hidden"
            style={{ background: '#08090c' }}
        >
            <div
                className="absolute inset-0"
                style={{
                    background:
                        'linear-gradient(135deg, #0d9488 0%, #7c3aed 50%, #db2777 100%)',
                }}
            />
            <div
                className="absolute inset-0 pointer-events-none opacity-30"
                style={{
                    backgroundImage:
                        'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
                    backgroundSize: '32px 32px',
                }}
            />

            <div
                ref={contentRef}
                className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center"
            >
                <h2
                    className="text-4xl sm:text-5xl font-bold text-white mb-6 leading-tight font-serif tracking-tight"
                >
                    Ready to give your media team
                    <br />a head start?
                </h2>
                <p className="text-xl text-white/80 mb-10 max-w-2xl mx-auto">
                    Be part of the first wave. Join free during our beta. No credit card, no
                    commitment. Just better services, starting Sunday.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                    <Link
                        to="/signup"
                        className="group flex items-center gap-2 px-8 py-4 bg-white text-primary-600 font-semibold rounded-2xl hover:bg-gray-50 transition-all shadow-xl text-lg hover:-translate-y-px"
                    >
                        Get Started Free
                        <ArrowRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                    </Link>
                    <Link
                        to="/login"
                        className="px-8 py-4 text-white font-semibold rounded-2xl border-2 border-white/30 hover:bg-white/10 transition-all text-lg"
                    >
                        Sign In
                    </Link>
                </div>
            </div>
        </section>
    )
}

function FooterSection() {
    return (
        <footer className="py-16 border-t border-white/5" style={{ background: '#08090c' }}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid md:grid-cols-4 gap-12 mb-12">
                    <div className="md:col-span-1">
                        <Link to="/" className="flex items-center gap-3 mb-4">
                            <div
                                className="w-10 h-10 rounded-xl flex items-center justify-center"
                                style={{ background: 'linear-gradient(135deg, #14b8a6, #0d9488)' }}
                            >
                                <BookOpen className="w-5 h-5 text-white" strokeWidth={2.25} />
                            </div>
                            <div>
                                <div
                                    style={{ fontFamily: 'Crimson Pro, serif', fontSize: '1.25rem', fontWeight: 600 }}
                                    className="text-white leading-none"
                                >
                                    Selah
                                </div>
                                <div
                                    className="text-[9px] font-mono uppercase tracking-[0.22em] mt-1"
                                    style={{ color: 'rgba(255,255,255,0.35)' }}
                                >
                                    Worship Studio
                                </div>
                            </div>
                        </Link>
                        <p
                            className="text-sm leading-relaxed"
                            style={{ color: 'rgba(228,228,231,0.5)' }}
                        >
                            A modern, AI-powered worship presentation platform built for
                            churches.
                        </p>
                    </div>

                    <div>
                        <h4 className="font-semibold text-white mb-4 text-sm">Product</h4>
                        <ul className="space-y-2.5">
                            {['Features', 'AI Listener', 'Pricing', 'Templates'].map((link) => (
                                <li key={link}>
                                    <a
                                        href="#"
                                        className="text-sm transition-colors"
                                        style={{ color: 'rgba(228,228,231,0.5)' }}
                                    >
                                        {link}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div>
                        <h4 className="font-semibold text-white mb-4 text-sm">Resources</h4>
                        <ul className="space-y-2.5">
                            {['Documentation', 'Whisper Setup', 'Blog', 'Community'].map((link) => (
                                <li key={link}>
                                    <a
                                        href="#"
                                        className="text-sm transition-colors"
                                        style={{ color: 'rgba(228,228,231,0.5)' }}
                                    >
                                        {link}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div>
                        <h4 className="font-semibold text-white mb-4 text-sm">Company</h4>
                        <ul className="space-y-2.5">
                            {['About', 'Contact', 'Privacy', 'Terms'].map((link) => (
                                <li key={link}>
                                    <a
                                        href="#"
                                        className="text-sm transition-colors"
                                        style={{ color: 'rgba(228,228,231,0.5)' }}
                                    >
                                        {link}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
                    <p
                        className="text-xs"
                        style={{ color: 'rgba(228,228,231,0.4)' }}
                    >
                        © {new Date().getFullYear()} Selah · Built for the Church
                    </p>
                    <div className="flex items-center gap-6">
                        <a
                            href="#"
                            className="text-xs transition-colors"
                            style={{ color: 'rgba(228,228,231,0.4)' }}
                        >
                            Privacy Policy
                        </a>
                        <a
                            href="#"
                            className="text-xs transition-colors"
                            style={{ color: 'rgba(228,228,231,0.4)' }}
                        >
                            Terms of Service
                        </a>
                    </div>
                </div>
            </div>
        </footer>
    )
}

export default function Landing() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
    const [activeLine, setActiveLine] = useState(-1)
    const [showDetected, setShowDetected] = useState(false)
    const [scrolled, setScrolled] = useState(false)

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 20)
        window.addEventListener('scroll', onScroll, { passive: true })
        return () => window.removeEventListener('scroll', onScroll)
    }, [])

    useEffect(() => {
        let mounted = true
        const run = () => {
            if (!mounted) return
            setActiveLine(-1)
            setShowDetected(false)
            transcriptDemo.forEach((line, i) => {
                setTimeout(() => {
                    if (!mounted) return
                    setActiveLine(i)
                    if (line.isVerse) {
                        setTimeout(() => {
                            if (mounted) setShowDetected(true)
                        }, 700)
                    }
                }, line.delay + 500)
            })
        }
        run()
        const loop = setInterval(run, 12000)
        return () => {
            mounted = false
            clearInterval(loop)
        }
    }, [])

    return (
        <div
            className="dark min-h-screen overflow-hidden"
            style={{ background: '#08090c', color: '#fff' }}
        >
            <NavBar
                scrolled={scrolled}
                mobileMenuOpen={mobileMenuOpen}
                setMobileMenuOpen={setMobileMenuOpen}
            />
            <HeroSection />
            <SermonListenerSection activeLine={activeLine} showDetected={showDetected} />
            <CoreFeaturesSection />
            <DashboardSection />
            <StandoutFeaturesSection />
            <EarlyAccessSection />
            <CtaSection />
            <FooterSection />
        </div>
    )
}
