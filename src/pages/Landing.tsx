import { Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
    BookOpen,
    ArrowRight,
    Menu,
    X,
    Mic,
    Brain,
    FileText,
    WifiOff,
    LayoutDashboard,
    Layers,
    Type,
    Palette,
    Lock,
    MessageSquare,
    UserCheck,
    Users,
    Check,
    Radio,
    Sliders,
    Volume2,
    Monitor,
    Cast,
    Sparkles,
} from 'lucide-react'
import { useScrollReveal } from '@/hooks/useScrollReveal'
import { Preloader } from '@/components/landing/Preloader'
import { Cursor } from '@/components/landing/Cursor'
import { Hero } from '@/components/landing/Hero'
import { SermonListener } from '@/components/landing/SermonListener'
import { FeaturesRail } from '@/components/landing/FeaturesRail'

// ─────────────────────────────────────────────────────────────────────────────
// Content
// ─────────────────────────────────────────────────────────────────────────────

const aiFeatures = [
    { icon: Mic, title: 'Listens as You Preach', description: 'Selah quietly listens through your microphone and follows your sermon in real time, with no manual input required.' },
    { icon: Brain, title: 'Understands Context', description: "Even when no verse is named, Selah reads between the lines and suggests scriptures that match what's being preached." },
    { icon: FileText, title: 'Catches Every Reference', description: 'Say “John chapter 3 verse 16” naturally and Selah finds it instantly, ready to display on screen.' },
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

const betaPerks = [
    { title: 'Free during beta', description: 'Full access at no cost while we build together.' },
    { title: 'Direct line to the team', description: 'Your feedback lands in our build queue, not a support ticket.' },
    { title: 'Locked-in early-bird pricing', description: '50% off your plan for life when we officially launch.' },
    { title: 'Onboard with us, not a tutorial', description: 'We will personally help your first service go live.' },
]

// Mock dashboard panels
const dashboardPanels = [
    { label: 'Quick Actions', col: 'col-span-1', row: 'row-span-2', accent: '#0d9488' },
    { label: 'Live Preview', col: 'col-span-2', row: '', accent: '#be123c' },
    { label: 'Service Order', col: 'col-span-2', row: '', accent: '#4338ca' },
    { label: 'AI Listener', col: 'col-span-2', row: '', accent: '#0d9488' },
    { label: 'Library', col: 'col-span-1', row: 'row-span-2', accent: '#d97706' },
]

// Standout section demo data
const avatarColors = [
    'from-teal-400 to-emerald-500',
    'from-amber-400 to-orange-500',
    'from-rose-400 to-pink-500',
    'from-violet-400 to-purple-500',
]

const pipelineBars = Array.from({ length: 40 }, (_, i) => {
    return Math.round(25 + Math.abs(Math.sin(i * 0.4)) * 60)
})

const suggestedSlides = [
    { label: 'Amazing Grace (V2)', color: '#f59e0b' },
    { label: 'John 3:16', color: '#0d9488' },
    { label: 'Offering slide', color: '#be123c' },
]

const SmallArrow = () => (
    <svg className="w-3 h-3 text-white/20 flex-shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)

// ─────────────────────────────────────────────────────────────────────────────
// NavBar — translucent, condenses on scroll
// ─────────────────────────────────────────────────────────────────────────────

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
        { href: '#sermon-listener', label: 'Sermon Listener' },
        { href: '#features', label: 'Features' },
        { href: '#dashboard', label: 'Dashboard' },
        { href: '#early-access', label: 'Beta' },
    ]

    return (
        <nav
            className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 border-b ${
                scrolled
                    ? 'bg-[#08090c]/80 backdrop-blur-xl border-white/5'
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
                        <span
                            className="text-white"
                            style={{ fontFamily: 'Crimson Pro, serif', fontSize: '1.3rem', fontWeight: 600 }}
                        >
                            Selah
                        </span>
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
                            className="text-sm font-medium text-white/70 hover:text-white transition-colors px-3 py-2"
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
                            data-cursor="Go"
                            className="group flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-full text-[#08090c] transition-all hover:-translate-y-px"
                            style={{
                                background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                                boxShadow: '0 8px 32px -4px rgba(20,184,166,0.45), inset 0 1px 0 rgba(255,255,255,0.2)',
                            }}
                        >
                            Get Started Free
                            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                        </Link>
                    </div>

                    <button
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        className="md:hidden p-2 text-white/60 hover:text-white"
                        aria-label="Toggle menu"
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
                                className="block w-full py-3 text-center text-sm font-semibold rounded-full text-[#08090c]"
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

// ─────────────────────────────────────────────────────────────────────────────
// AI Features — "How it listens"
// ─────────────────────────────────────────────────────────────────────────────

function AiFeaturesSection() {
    const headingRef = useScrollReveal<HTMLDivElement>('fade-up', { start: 'top 85%' })
    const gridRef = useScrollReveal<HTMLDivElement>('stagger', { start: 'top 82%', staggerAmount: 0.1 })

    return (
        <section className="relative py-24 lg:py-32 overflow-hidden" style={{ background: '#08090c' }}>
            <div
                className="absolute inset-0 pointer-events-none opacity-30"
                style={{
                    background:
                        'radial-gradient(ellipse 50% 50% at 80% 20%, rgba(20,184,166,0.08), transparent 60%)',
                }}
            />

            <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
                <div ref={headingRef} className="max-w-2xl mb-14">
                    <p className="text-xs font-mono uppercase tracking-[0.3em] text-teal-400 mb-4">
                        How it listens
                    </p>
                    <h2
                        className="text-4xl sm:text-5xl text-white"
                        style={{ fontFamily: 'Crimson Pro, serif', fontWeight: 600, lineHeight: 1.05 }}
                    >
                        It doesn&rsquo;t transcribe.
                        <br />
                        <span
                            className="italic"
                            style={{
                                background: 'linear-gradient(135deg, #5eead4 0%, #fcd34d 100%)',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text',
                            }}
                        >
                            It understands.
                        </span>
                    </h2>
                </div>

                <div
                    ref={gridRef}
                    className="grid sm:grid-cols-2 gap-px bg-white/[0.06] rounded-2xl overflow-hidden border border-white/[0.06]"
                >
                    {aiFeatures.map((f) => (
                        <div
                            key={f.title}
                            className="group p-8 transition-colors hover:bg-white/[0.02]"
                            style={{ background: '#08090c' }}
                        >
                            <div className="flex items-center gap-3 mb-4">
                                <div
                                    className="w-10 h-10 rounded-xl flex items-center justify-center"
                                    style={{
                                        background: 'rgba(20,184,166,0.12)',
                                        border: '1px solid rgba(20,184,166,0.2)',
                                    }}
                                >
                                    <f.icon className="w-4 h-4 text-teal-300" />
                                </div>
                                <h3 className="text-lg font-semibold text-white font-serif">{f.title}</h3>
                            </div>
                            <p className="text-sm leading-relaxed text-zinc-400">{f.description}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard — adaptive layout editorial split
// ─────────────────────────────────────────────────────────────────────────────

function DashboardSection() {
    const colLeftRef = useScrollReveal<HTMLDivElement>('fade-right', { start: 'top 80%' })
    const colRightRef = useScrollReveal<HTMLDivElement>('scale', { start: 'top 80%', delay: 0.12 })

    return (
        <section
            id="dashboard"
            className="relative py-24 lg:py-32 overflow-hidden"
            style={{ background: '#08090c' }}
        >
            <div
                className="absolute inset-0 pointer-events-none opacity-40"
                style={{
                    background:
                        'radial-gradient(ellipse 55% 55% at 80% 50%, rgba(217,119,6,0.08), transparent 65%)',
                }}
            />
            <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid lg:grid-cols-2 gap-16 items-center">
                    <div ref={colLeftRef}>
                        <p className="text-xs font-mono uppercase tracking-[0.3em] text-amber-400 mb-4">
                            Adaptive Dashboard
                        </p>
                        <h2
                            className="mb-6 text-4xl sm:text-5xl text-white"
                            style={{ fontFamily: 'Crimson Pro, serif', fontWeight: 600, lineHeight: 1.05 }}
                        >
                            Your layout,
                            <br />
                            <span
                                className="italic"
                                style={{
                                    background: 'linear-gradient(135deg, #fcd34d 0%, #f59e0b 100%)',
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent',
                                    backgroundClip: 'text',
                                }}
                            >
                                your way.
                            </span>
                        </h2>
                        <p className="mb-8 leading-relaxed text-lg text-zinc-400 max-w-md">
                            Selah&rsquo;s drag-and-drop dashboard adapts to every volunteer&rsquo;s workflow.
                            Resize and reposition every panel. Your layout is saved per user, per church.
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
                                    <div className="font-semibold text-white text-[0.88rem]">{f.title}</div>
                                    <div className="mt-1 leading-relaxed text-zinc-500 text-[0.78rem]">
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
                            className="p-4 grid grid-cols-3 gap-2 grid-rows-2 text-xs"
                            style={{ minHeight: '360px' }}
                        >
                            {dashboardPanels.map((p) => (
                                <div
                                    key={p.label}
                                    className={`${p.col} ${p.row} flex items-center justify-center rounded-xl p-3 font-semibold relative overflow-hidden`}
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
                                            className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-transparent via-teal-400/60 to-transparent"
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

// ─────────────────────────────────────────────────────────────────────────────
// Standout — three flagship features
// ─────────────────────────────────────────────────────────────────────────────

function StandoutSection() {
    const headingRef = useScrollReveal<HTMLDivElement>('fade-up', { start: 'top 88%' })
    const gridRef = useScrollReveal<HTMLDivElement>('stagger', { start: 'top 82%', staggerAmount: 0.12 })

    return (
        <section
            className="relative py-24 lg:py-32 overflow-hidden"
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
                    {/* Card 1 — Collaboration */}
                    <article
                        data-cursor="Team"
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
                                style={{ background: 'rgba(20,184,166,0.12)', color: '#5eead4' }}
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
                                Your whole team works the service together. See who&rsquo;s
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
                                        <mode.icon className="w-2.5 h-2.5 text-teal-400" />
                                        <span className="font-medium">{mode.label}</span>
                                        <span style={{ color: 'rgba(255,255,255,0.35)' }}>· {mode.desc}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </article>

                    {/* Card 2 — Audio Pipeline */}
                    <article
                        data-cursor="Audio"
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
                                                background: 'linear-gradient(180deg, #22d3ee 0%, #0e7490 100%)',
                                                animation: `waveform-bar 1.1s ease-in-out ${i * 0.035}s infinite`,
                                                opacity: 0.8,
                                                minHeight: '3px',
                                                maxHeight: `${h}%`,
                                            }}
                                        />
                                    ))}
                                </div>
                                <div className="flex items-center justify-center gap-2 mb-3">
                                    {[
                                        { Ic: Mic, l: 'Mic' },
                                        { Ic: Sliders, l: 'Mixer' },
                                        { Ic: Volume2, l: 'Any app' },
                                    ].map(({ Ic, l }) => (
                                        <div
                                            key={l}
                                            className="flex items-center gap-1 px-2 py-1 rounded-md"
                                            style={{
                                                background: 'rgba(34,211,238,0.08)',
                                                border: '1px solid rgba(34,211,238,0.18)',
                                            }}
                                        >
                                            <Ic className="w-2.5 h-2.5 text-cyan-400" />
                                            <span className="text-[8px] font-mono uppercase tracking-widest text-cyan-300">
                                                {l}
                                            </span>
                                        </div>
                                    ))}
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
                                    <SmallArrow />
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
                                    <SmallArrow />
                                    <div
                                        className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-md"
                                        style={{
                                            background: 'rgba(20,184,166,0.12)',
                                            border: '1px solid rgba(20,184,166,0.25)',
                                        }}
                                    >
                                        <Type className="w-3 h-3 text-teal-400" />
                                        <span className="text-[9px] font-mono uppercase tracking-widest text-teal-300">
                                            Perfect text
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest mb-3"
                                style={{ background: 'rgba(168,85,247,0.12)', color: '#c4b5fd' }}
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
                    </article>

                    {/* Card 3 — NDI */}
                    <article
                        data-cursor="Output"
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
                                style={{ background: 'rgba(59,130,246,0.12)', color: '#93c5fd' }}
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
                    </article>
                </div>
            </div>
        </section>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Early Access — the closing CTA. Calm, confident, no hard sell.
// ─────────────────────────────────────────────────────────────────────────────

function EarlyAccessSection() {
    const sectionRef = useScrollReveal<HTMLElement>('fade-up', { start: 'top 86%' })

    return (
        <section
            ref={sectionRef}
            id="early-access"
            className="relative py-24 lg:py-36 overflow-hidden"
            style={{ background: '#08090c' }}
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
                        background:
                            'linear-gradient(180deg, rgba(20,184,166,0.06) 0%, rgba(255,255,255,0.02) 100%)',
                        border: '1px solid rgba(20,184,166,0.25)',
                        boxShadow:
                            '0 40px 80px -20px rgba(0,0,0,0.5), 0 0 80px -20px rgba(20,184,166,0.2)',
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
                    <h2 className="text-4xl md:text-5xl font-bold text-white mb-5 leading-tight font-serif tracking-tight">
                        Try Selah on your next service.
                    </h2>
                    <p className="text-lg mb-10 max-w-2xl mx-auto leading-relaxed text-zinc-400">
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
                                    <Check className="w-4 h-4 text-teal-400" />
                                </div>
                                <div>
                                    <div className="font-semibold text-white mb-0.5">{perk.title}</div>
                                    <div className="text-sm text-zinc-500">{perk.description}</div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <Link
                        to="/signup"
                        data-cursor="Go"
                        className="group inline-flex items-center gap-2 px-8 py-4 font-semibold rounded-full text-[#08090c] text-lg transition-all hover:-translate-y-px"
                        style={{
                            background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                            boxShadow:
                                '0 8px 32px -4px rgba(20,184,166,0.45), inset 0 1px 0 rgba(255,255,255,0.15)',
                        }}
                    >
                        Get Started Free
                        <ArrowRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                    </Link>
                    <p className="mt-5 text-sm italic text-zinc-500">No credit card · Cancel anytime</p>
                </div>
            </div>
        </section>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Footer
// ─────────────────────────────────────────────────────────────────────────────

function FooterSection() {
    const linkGroups = [
        { title: 'Product', links: ['Features', 'AI Listener', 'Pricing', 'Templates'] },
        { title: 'Resources', links: ['Documentation', 'Whisper Setup', 'Blog', 'Community'] },
        { title: 'Company', links: ['About', 'Contact', 'Privacy', 'Terms'] },
    ]

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
                                    className="text-white leading-none"
                                    style={{ fontFamily: 'Crimson Pro, serif', fontSize: '1.25rem', fontWeight: 600 }}
                                >
                                    Selah
                                </div>
                                <div className="text-[9px] font-mono uppercase tracking-[0.22em] mt-1 text-white/35">
                                    Worship Studio
                                </div>
                            </div>
                        </Link>
                        <p className="text-sm leading-relaxed text-zinc-500">
                            A modern, AI-powered worship presentation platform built for churches.
                        </p>
                    </div>

                    {linkGroups.map((group) => (
                        <div key={group.title}>
                            <h4 className="font-semibold text-white mb-4 text-sm">{group.title}</h4>
                            <ul className="space-y-2.5">
                                {group.links.map((link) => (
                                    <li key={link}>
                                        <a href="#" className="text-sm text-zinc-500 hover:text-white transition-colors">
                                            {link}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
                    <p className="text-xs text-zinc-600">© {new Date().getFullYear()} Selah · Built for the Church</p>
                    <div className="flex items-center gap-6">
                        <a href="#" className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors">
                            Privacy Policy
                        </a>
                        <a href="#" className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors">
                            Terms of Service
                        </a>
                    </div>
                </div>
            </div>
        </footer>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function Landing() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
    const [scrolled, setScrolled] = useState(false)
    const [started, setStarted] = useState(false)

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 20)
        window.addEventListener('scroll', onScroll, { passive: true })
        return () => window.removeEventListener('scroll', onScroll)
    }, [])

    // Lock body scroll while the preloader is on screen so the opening
    // animation doesn't fight the scrollbar.
    useEffect(() => {
        document.body.style.overflow = started ? '' : 'hidden'
        return () => {
            document.body.style.overflow = ''
        }
    }, [started])

    return (
        <div
            className="dark min-h-screen overflow-x-hidden"
            style={{ background: '#08090c', color: '#fff' }}
        >
            <Preloader onDone={() => setStarted(true)} />
            <Cursor />
            <NavBar
                scrolled={scrolled}
                mobileMenuOpen={mobileMenuOpen}
                setMobileMenuOpen={setMobileMenuOpen}
            />
            <Hero started={started} />
            <SermonListener />
            <AiFeaturesSection />
            <FeaturesRail />
            <DashboardSection />
            <StandoutSection />
            <EarlyAccessSection />
            <FooterSection />
        </div>
    )
}
