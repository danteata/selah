import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
    AlertCircle,
    Apple,
    Check,
    Copy,
    Cpu,
    Download,
    ExternalLink,
    Github,
    HardDrive,
    Loader2,
    Menu,
    Monitor,
    RefreshCw,
    ShieldCheck,
    Sparkles,
    Terminal,
    X,
    ArrowRight,
    BookOpen,
} from 'lucide-react'
import { gsap } from '../lib/gsap'
import { useScrollReveal } from '../hooks/useScrollReveal'
import { useLatestRelease, SELAH_REPO, type PlatformBucket } from '../hooks/useLatestRelease'
import { detectPlatform, type UserOS, type UserPlatform } from '../lib/userPlatform'

const RELEASES_PAGE = `https://github.com/${SELAH_REPO.owner}/${SELAH_REPO.repo}/releases`

/* ----------------------------- Helpers ---------------------------------- */

function formatBytes(bytes: number): string {
    if (!bytes) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    let i = 0
    let value = bytes
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024
        i += 1
    }
    return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDate(iso: string | null): string {
    if (!iso) return 'Unreleased'
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

/* --------------------------- Platform icons ------------------------------ */

function PlatformIcon({ os, className }: { os: UserOS; className?: string }) {
    if (os === 'macos') {
        return (
            <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
                <path d="M16.365 1.43c0 1.14-.42 2.23-1.13 3.02-.74.84-1.95 1.49-3.04 1.4-.13-1.13.41-2.31 1.1-3.05.77-.86 2.07-1.5 3.07-1.37zm3.55 16.27c-.55 1.28-.81 1.85-1.52 2.98-1 1.58-2.41 3.55-4.16 3.56-1.55.02-1.95-1.01-4.06-1-2.11.01-2.55 1.02-4.1 1-1.75-.02-3.09-1.79-4.09-3.37-2.79-4.43-3.08-9.62-1.36-12.39 1.22-1.96 3.15-3.1 4.96-3.1 1.85 0 3.01 1.02 4.54 1.02 1.49 0 2.39-1.02 4.52-1.02 1.62 0 3.34.88 4.55 2.41-4 2.19-3.35 7.92.72 9.91z" />
            </svg>
        )
    }
    if (os === 'windows') {
        return (
            <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
                <path d="M3 5.5L10.5 4.5v7.5H3v-6.5zm0 7.5h7.5v6.5L3 18.5V13zm8.5-8.6L21 3.5v8.5h-9.5V4.4zM11.5 13H21v8.5l-9.5-1.4V13z" />
            </svg>
        )
    }
    if (os === 'linux') {
        return <Terminal className={className} aria-hidden />
    }
    return <Monitor className={className} aria-hidden />
}

const OS_META: Record<UserOS, { name: string; tagline: string; accent: string }> = {
    macos: {
        name: 'macOS',
        tagline: 'Universal build, runs natively on Apple Silicon and Intel.',
        accent: '#a1a1aa',
    },
    windows: {
        name: 'Windows',
        tagline: 'Signed NSIS installer for 64-bit and ARM64 machines.',
        accent: '#3b82f6',
    },
    linux: {
        name: 'Linux',
        tagline: 'Portable AppImage — works on Ubuntu, Fedora, Arch, and friends.',
        accent: '#f59e0b',
    },
    unknown: {
        name: 'Other',
        tagline: 'Pick the build that matches your machine.',
        accent: '#71717a',
    },
}

/* ----------------------------- Nav ---------------------------------- */

function NavBar({
    scrolled,
    mobileMenuOpen,
    setMobileMenuOpen,
}: {
    scrolled: boolean
    mobileMenuOpen: boolean
    setMobileMenuOpen: (v: boolean) => void
}) {
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
                        <Link
                            to="/"
                            className="px-3 py-2 text-sm font-medium text-white/60 hover:text-white transition-colors rounded-lg hover:bg-white/5"
                        >
                            Overview
                        </Link>
                        <span
                            className="px-3 py-2 text-sm font-semibold text-white rounded-lg"
                            style={{ background: 'rgba(255,255,255,0.05)' }}
                        >
                            Download
                        </span>
                        <a
                            href={RELEASES_PAGE}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-2 text-sm font-medium text-white/60 hover:text-white transition-colors rounded-lg hover:bg-white/5"
                        >
                            Releases
                        </a>
                    </div>

                    <div className="hidden md:flex items-center gap-3">
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
                        <Link
                            to="/"
                            onClick={() => setMobileMenuOpen(false)}
                            className="block py-2.5 px-3 text-sm text-white/70 hover:text-white hover:bg-white/5 rounded-lg"
                        >
                            Overview
                        </Link>
                        <span className="block py-2.5 px-3 text-sm font-semibold text-white rounded-lg bg-white/5">
                            Download
                        </span>
                        <a
                            href={RELEASES_PAGE}
                            target="_blank"
                            rel="noreferrer"
                            className="block py-2.5 px-3 text-sm text-white/70 hover:text-white hover:bg-white/5 rounded-lg"
                        >
                            Releases
                        </a>
                        <div className="pt-3 mt-3 border-t border-white/5 space-y-2">
                            <Link
                                to="/login"
                                onClick={() => setMobileMenuOpen(false)}
                                className="block py-2.5 px-3 text-sm text-white/70 hover:text-white rounded-lg"
                            >
                                Sign In
                            </Link>
                            <Link
                                to="/signup"
                                onClick={() => setMobileMenuOpen(false)}
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

/* ----------------------- Detected-platform CTA --------------------------- */

function HeroCTA({
    platform,
    release,
}: {
    platform: UserPlatform
    release: ReturnType<typeof useLatestRelease>['release']
}) {
    if (!release) return null
    const bucket = release.buckets.find((b) => b.os === platform.os)
    const variant =
        bucket?.variants.find((v) => v.label.toLowerCase().includes(platform.arch)) ??
        bucket?.variants[0]

    if (!variant) {
        return (
            <div className="flex flex-col items-center gap-2">
                <p className="text-sm text-white/60">
                    We don't have a {platform.label} build in this release yet.
                </p>
                <a
                    href={RELEASES_PAGE}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary-300 hover:text-primary-200 text-sm font-semibold inline-flex items-center gap-1.5"
                >
                    Browse all releases <ExternalLink className="w-3.5 h-3.5" />
                </a>
            </div>
        )
    }

    return (
        <a
            href={variant.url}
            className="group flex items-center gap-3 px-7 py-4 font-semibold rounded-2xl text-white transition-all hover:-translate-y-px"
            style={{
                background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                boxShadow:
                    '0 12px 40px -8px rgba(20,184,166,0.5), inset 0 1px 0 rgba(255,255,255,0.15)',
            }}
        >
            <Download className="w-5 h-5" strokeWidth={2.25} />
            <span className="text-left leading-tight">
                <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-primary-100/80">
                    Download for {platform.label}
                </span>
                <span className="block text-base font-bold">
                    Selah {release.version} · {formatBytes(variant.size)}
                </span>
            </span>
            <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-0.5 transition-transform" />
        </a>
    )
}

/* --------------------------- Platform cards ----------------------------- */

function CopyButton({ value, label }: { value: string; label?: string }) {
    const [copied, setCopied] = useState(false)
    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1800)
        } catch {
            // Old browsers / non-secure contexts — silently no-op.
        }
    }
    return (
        <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-white/40 hover:text-primary-300 transition-colors"
            title="Copy direct URL"
        >
            {copied ? (
                <>
                    <Check className="w-3 h-3" /> Copied
                </>
            ) : (
                <>
                    <Copy className="w-3 h-3" /> {label ?? 'Copy URL'}
                </>
            )}
        </button>
    )
}

function VariantRow({
    variant,
    recommended,
}: {
    variant: { label: string; url: string; fileName: string; size: number; format: string }
    recommended: boolean
}) {
    return (
        <div
            className="rounded-xl p-4 transition-all"
            style={{
                background: recommended
                    ? 'linear-gradient(135deg, rgba(20,184,166,0.10) 0%, rgba(20,184,166,0.03) 100%)'
                    : 'rgba(255,255,255,0.025)',
                border: recommended
                    ? '1px solid rgba(20,184,166,0.32)'
                    : '1px solid rgba(255,255,255,0.06)',
            }}
        >
            <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-semibold text-white">{variant.label}</span>
                        {recommended && (
                            <span
                                className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-widest"
                                style={{ background: 'rgba(20,184,166,0.22)', color: '#5eead4' }}
                            >
                                Detected
                            </span>
                        )}
                    </div>
                    <div className="text-[11px] text-white/45 font-mono truncate" title={variant.fileName}>
                        {variant.fileName}
                    </div>
                </div>
                <div className="text-right flex-shrink-0">
                    <div className="text-xs font-mono text-white/70">{formatBytes(variant.size)}</div>
                    <div className="text-[9px] font-mono uppercase tracking-widest text-white/35">
                        {variant.format}
                    </div>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <a
                    href={variant.url}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-white transition-all hover:brightness-110"
                    style={{
                        background: recommended
                            ? 'linear-gradient(135deg, #14b8a6, #0d9488)'
                            : 'rgba(255,255,255,0.08)',
                        border: recommended ? 'none' : '1px solid rgba(255,255,255,0.1)',
                    }}
                >
                    <Download className="w-3.5 h-3.5" />
                    Download
                </a>
                <CopyButton value={variant.url} />
            </div>
        </div>
    )
}

function PlatformCard({
    bucket,
    detectedArch,
    detectedOS,
}: {
    bucket: PlatformBucket
    detectedArch: string
    detectedOS: UserOS
}) {
    const meta = OS_META[bucket.os]
    const isDetected = detectedOS === bucket.os
    const hasNoAssets = bucket.variants.length === 0

    return (
        <div
            className="relative rounded-2xl p-6 overflow-hidden transition-all hover:-translate-y-1 flex flex-col"
            style={{
                background:
                    'linear-gradient(180deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.012) 100%)',
                border: isDetected
                    ? '1px solid rgba(20,184,166,0.32)'
                    : '1px solid rgba(255,255,255,0.07)',
                boxShadow: isDetected
                    ? '0 30px 60px -20px rgba(20,184,166,0.18), inset 0 1px 0 rgba(255,255,255,0.05)'
                    : '0 20px 40px -20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)',
                backdropFilter: 'blur(10px)',
            }}
        >
            {isDetected && (
                <div
                    className="absolute inset-0 pointer-events-none opacity-60"
                    style={{
                        background: `radial-gradient(circle at 50% 0%, rgba(20,184,166,0.16), transparent 60%)`,
                    }}
                />
            )}

            <div className="relative flex flex-col h-full">
                <div className="flex items-start justify-between mb-5">
                    <div
                        className="w-12 h-12 rounded-2xl flex items-center justify-center"
                        style={{
                            background: `${meta.accent}18`,
                            border: `1px solid ${meta.accent}30`,
                            color: meta.accent,
                        }}
                    >
                        <PlatformIcon os={bucket.os} className="w-6 h-6" />
                    </div>
                    {isDetected && (
                        <span
                            className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest"
                            style={{ background: 'rgba(20,184,166,0.18)', color: '#5eead4' }}
                        >
                            Your platform
                        </span>
                    )}
                </div>

                <h3 className="text-xl font-semibold text-white mb-1 font-serif tracking-tight">
                    {meta.name}
                </h3>
                <p className="text-sm text-white/55 leading-relaxed mb-5 min-h-[2.5em]">{meta.tagline}</p>

                <div className="space-y-2.5 mt-auto">
                    {hasNoAssets ? (
                        <div
                            className="rounded-xl p-4 text-center text-xs text-white/45"
                            style={{
                                background: 'rgba(255,255,255,0.02)',
                                border: '1px dashed rgba(255,255,255,0.1)',
                            }}
                        >
                            No {meta.name} build in this release.
                        </div>
                    ) : (
                        bucket.variants.map((v) => (
                            <VariantRow
                                key={v.label + v.fileName}
                                variant={v}
                                recommended={isDetected && v.label.toLowerCase().includes(detectedArch)}
                            />
                        ))
                    )}
                </div>
            </div>
        </div>
    )
}

/* --------------------------- Release notes ------------------------------ */

/**
 * Render a tiny subset of GitHub-flavoured Markdown just well enough for
 * release notes: paragraphs, bullet lists, headings, fenced code, and
 * inline code/links. Anything else falls through as plain text.
 */
function renderNotes(body: string | null): React.ReactNode {
    if (!body) {
        return (
            <p className="text-sm text-white/45 italic">No release notes were published for this version.</p>
        )
    }
    const blocks = body.replace(/\r\n/g, '\n').split(/\n{2,}/)
    return blocks.map((block, i) => {
        const trimmed = block.trim()
        if (!trimmed) return null
        if (trimmed.startsWith('### ')) {
            return (
                <h4 key={i} className="text-sm font-semibold text-white mt-5 mb-2 font-serif">
                    {inlineFormat(trimmed.slice(4))}
                </h4>
            )
        }
        if (trimmed.startsWith('## ')) {
            return (
                <h3 key={i} className="text-base font-semibold text-white mt-6 mb-2 font-serif tracking-tight">
                    {inlineFormat(trimmed.slice(3))}
                </h3>
            )
        }
        if (trimmed.startsWith('# ')) {
            return (
                <h2 key={i} className="text-lg font-semibold text-white mt-6 mb-3 font-serif tracking-tight">
                    {inlineFormat(trimmed.slice(2))}
                </h2>
            )
        }
        if (trimmed.startsWith('```')) {
            const code = trimmed.replace(/^```[a-z]*\n?|```$/g, '')
            return (
                <pre
                    key={i}
                    className="rounded-xl p-3 text-xs font-mono text-white/80 overflow-x-auto mb-3"
                    style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.05)' }}
                >
                    {code}
                </pre>
            )
        }
        if (/^[-*] /m.test(trimmed)) {
            const items = trimmed.split('\n').filter((l) => /^[-*] /.test(l))
            return (
                <ul key={i} className="list-disc pl-5 mb-3 space-y-1.5 text-sm text-white/70">
                    {items.map((item, j) => (
                        <li key={j}>{inlineFormat(item.replace(/^[-*] /, ''))}</li>
                    ))}
                </ul>
            )
        }
        return (
            <p key={i} className="text-sm text-white/70 leading-relaxed mb-3">
                {inlineFormat(trimmed)}
            </p>
        )
    })
}

function inlineFormat(text: string): React.ReactNode {
    // Handle `code`, **bold**, *italic*, [link](url). Order matters — code first.
    const parts: React.ReactNode[] = []
    const remaining = text
    let key = 0
    const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
    let lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(remaining)) !== null) {
        if (match.index > lastIndex) {
            parts.push(remaining.slice(lastIndex, match.index))
        }
        const token = match[0]
        if (token.startsWith('`')) {
            parts.push(
                <code
                    key={key++}
                    className="px-1 py-0.5 rounded text-[12px] font-mono"
                    style={{ background: 'rgba(20,184,166,0.15)', color: '#5eead4' }}
                >
                    {token.slice(1, -1)}
                </code>
            )
        } else if (token.startsWith('**')) {
            parts.push(
                <strong key={key++} className="font-semibold text-white">
                    {token.slice(2, -2)}
                </strong>
            )
        } else if (token.startsWith('*')) {
            parts.push(
                <em key={key++} className="italic">
                    {token.slice(1, -1)}
                </em>
            )
        } else if (token.startsWith('[')) {
            const linkMatch = /\[([^\]]+)\]\(([^)]+)\)/.exec(token)
            if (linkMatch) {
                parts.push(
                    <a
                        key={key++}
                        href={linkMatch[2]}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary-300 hover:text-primary-200 underline underline-offset-2"
                    >
                        {linkMatch[1]}
                    </a>
                )
            }
        }
        lastIndex = match.index + token.length
    }
    if (lastIndex < remaining.length) parts.push(remaining.slice(lastIndex))
    return parts
}

/* ----------------------------- Sections --------------------------------- */

function HeroSection({ release, error, retry }: { release: ReturnType<typeof useLatestRelease>['release']; error: string | null; retry: () => void }) {
    const heroRef = useRef<HTMLElement>(null)
    const userPlatform = useMemo(() => detectPlatform(), [])

    useEffect(() => {
        const el = heroRef.current
        if (!el) return
        const ctx = gsap.context(() => {
            gsap.set(
                [
                    '.dl-badge',
                    '.dl-headline',
                    '.dl-sub',
                    '.dl-cta',
                    '.dl-stat',
                    '.dl-orb',
                ],
                { opacity: 0 }
            )
            const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
            tl.to('.dl-badge', { opacity: 1, y: 0, duration: 0.6, delay: 0.15 })
                .fromTo(
                    '.dl-headline',
                    { opacity: 0, y: 44 },
                    { opacity: 1, y: 0, duration: 0.8, stagger: 0.12 },
                    '-=0.3'
                )
                .to('.dl-sub', { opacity: 1, y: 0, duration: 0.6 }, '-=0.3')
                .to('.dl-cta', { opacity: 1, y: 0, duration: 0.5, stagger: 0.08 }, '-=0.3')
                .to('.dl-stat', { opacity: 1, y: 0, duration: 0.45, stagger: 0.06 }, '-=0.25')
                .fromTo(
                    '.dl-orb',
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
                className="absolute inset-0 pointer-events-none"
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
                className="dl-orb absolute top-32 left-[12%] w-72 h-72 bg-primary-500/20 rounded-full blur-3xl pointer-events-none"
                style={{ animation: 'blob 9s infinite' }}
            />
            <div
                className="dl-orb absolute top-48 right-[10%] w-64 h-64 bg-amber-500/12 rounded-full blur-3xl pointer-events-none"
                style={{ animation: 'blob 11s infinite 2s' }}
            />
            <div
                className="dl-orb absolute bottom-20 left-1/3 w-56 h-56 bg-pink-500/10 rounded-full blur-3xl pointer-events-none"
                style={{ animation: 'blob 13s infinite 4s' }}
            />

            <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center">
                    <div
                        className="dl-badge inline-flex items-center gap-2 px-4 py-2 rounded-full mb-7"
                        style={{
                            background: 'linear-gradient(135deg, rgba(20,184,166,0.15) 0%, rgba(13,148,136,0.08) 100%)',
                            border: '1px solid rgba(20,184,166,0.35)',
                            boxShadow: '0 8px 24px -8px rgba(20,184,166,0.3), inset 0 1px 0 rgba(255,255,255,0.06)',
                        }}
                    >
                        <Sparkles className="w-3.5 h-3.5 text-primary-300" />
                        <span className="text-xs font-semibold text-primary-200">
                            {release ? `Selah ${release.version} is out` : 'Native desktop apps'}
                        </span>
                    </div>

                    <h1
                        className="font-bold leading-[1.04] text-white mb-6 font-serif tracking-tight"
                        style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', textShadow: '0 1px 0 rgba(0,0,0,0.4)' }}
                    >
                        <span className="dl-headline block">Run Selah</span>
                        <span
                            className="dl-headline block italic"
                            style={{
                                background: 'linear-gradient(135deg, #5eead4 0%, #2dd4bf 45%, #fcd34d 100%)',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text',
                            }}
                        >
                            right on your machine.
                        </span>
                    </h1>

                    <p
                        className="dl-sub text-base lg:text-lg max-w-2xl mx-auto mb-10 leading-relaxed"
                        style={{ color: 'rgba(228,228,231,0.75)' }}
                    >
                        Native desktop apps for macOS, Windows, and Linux. No browser tab
                        to babysit, no streaming lag — just Selah, the way it was meant to run.
                    </p>

                    <div className="dl-cta flex flex-col sm:flex-row items-center justify-center gap-3 mb-12">
                        {release ? (
                            <HeroCTA platform={userPlatform} release={release} />
                        ) : error ? (
                            <ErrorState error={error} onRetry={retry} />
                        ) : (
                            <div
                                className="flex items-center gap-2 px-7 py-4 rounded-2xl"
                                style={{
                                    background: 'rgba(255,255,255,0.04)',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                }}
                            >
                                <Loader2 className="w-5 h-5 text-primary-300 animate-spin" />
                                <span className="text-sm font-semibold text-white/70">
                                    Loading the latest release…
                                </span>
                            </div>
                        )}

                        <a
                            href={RELEASES_PAGE}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 px-6 py-3.5 font-semibold rounded-2xl text-white/80 transition-all hover:text-white hover:bg-white/5"
                            style={{
                                border: '1px solid rgba(255,255,255,0.1)',
                                background: 'rgba(255,255,255,0.03)',
                                backdropFilter: 'blur(10px)',
                            }}
                        >
                            <Github className="w-4 h-4" />
                            All releases
                            <ExternalLink className="w-3 h-3 opacity-60" />
                        </a>
                    </div>

                    {release && (
                        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
                            <Stat label="Latest version" value={`v${release.version}`} />
                            <Stat label="Released" value={formatDate(release.publishedAt)} />
                            <Stat
                                label="Detected"
                                value={userPlatform.label}
                                highlight
                            />
                        </div>
                    )}
                </div>
            </div>
        </section>
    )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div className="dl-stat text-center">
            <div
                style={{
                    fontFamily: 'Crimson Pro, serif',
                    fontSize: highlight ? '1.5rem' : '1.4rem',
                    fontWeight: 700,
                    background: highlight
                        ? 'linear-gradient(135deg, #5eead4 0%, #2dd4bf 100%)'
                        : 'linear-gradient(180deg, #ffffff 0%, #a1a1aa 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    lineHeight: 1,
                }}
            >
                {value}
            </div>
            <div
                className="mt-1.5 uppercase"
                style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em' }}
            >
                {label}
            </div>
        </div>
    )
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
    return (
        <div
            className="flex flex-col items-center gap-3 px-6 py-4 rounded-2xl"
            style={{
                background: 'rgba(239,68,68,0.06)',
                border: '1px solid rgba(239,68,68,0.25)',
            }}
        >
            <div className="flex items-center gap-2 text-rose-300 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
            </div>
            <div className="flex items-center gap-2">
                <button
                    onClick={onRetry}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/70 hover:text-white transition-colors"
                >
                    <RefreshCw className="w-3 h-3" /> Try again
                </button>
                <span className="text-white/20">·</span>
                <a
                    href={RELEASES_PAGE}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-300 hover:text-primary-200 transition-colors"
                >
                    View on GitHub <ExternalLink className="w-3 h-3" />
                </a>
            </div>
        </div>
    )
}

/* -------------------------- Sections: cards / notes --------------------- */

function PlatformsSection({
    release,
    detected,
}: {
    release: ReturnType<typeof useLatestRelease>['release']
    detected: UserPlatform
}) {
    const headingRef = useScrollReveal<HTMLDivElement>('fade-up', { start: 'top 88%' })
    const gridRef = useScrollReveal<HTMLDivElement>('stagger', { start: 'top 85%', staggerAmount: 0.1 })

    if (!release) return null

    return (
        <section
            className="relative py-20 lg:py-28 overflow-hidden"
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
                <div ref={headingRef} className="text-center mb-12">
                    <div
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-4 text-[10px] font-bold uppercase tracking-[0.22em]"
                        style={{
                            background: 'linear-gradient(135deg, rgba(20,184,166,0.15) 0%, rgba(13,148,136,0.08) 100%)',
                            border: '1px solid rgba(20,184,166,0.35)',
                            color: '#5eead4',
                        }}
                    >
                        <HardDrive className="w-3 h-3" /> All Platforms
                    </div>
                    <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3 font-serif tracking-tight">
                        Pick your platform
                    </h2>
                    <p className="text-base max-w-xl mx-auto" style={{ color: 'rgba(228,228,231,0.6)' }}>
                        The right installer for your machine is highlighted. All builds
                        include the in-app updater, so you'll only ever download once.
                    </p>
                </div>

                <div ref={gridRef} className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {release.buckets.map((bucket) => (
                        <PlatformCard
                            key={bucket.os}
                            bucket={bucket}
                            detectedArch={detected.arch}
                            detectedOS={detected.os}
                        />
                    ))}
                </div>
            </div>
        </section>
    )
}

function ReleaseNotesSection({ release }: { release: ReturnType<typeof useLatestRelease>['release'] }) {
    const headingRef = useScrollReveal<HTMLDivElement>('fade-up', { start: 'top 88%' })
    if (!release) return null
    return (
        <section
            className="relative py-20 lg:py-28 overflow-hidden"
            style={{ background: '#08090c' }}
        >
            <div
                className="absolute inset-0 pointer-events-none opacity-40"
                style={{
                    background:
                        'radial-gradient(ellipse 55% 55% at 80% 50%, rgba(217,119,6,0.08), transparent 65%)',
                }}
            />
            <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                <div ref={headingRef} className="mb-8">
                    <div
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-4 text-[10px] font-bold uppercase tracking-[0.22em]"
                        style={{
                            background:
                                'linear-gradient(135deg, rgba(217,119,6,0.15) 0%, rgba(180,83,9,0.08) 100%)',
                            border: '1px solid rgba(217,119,6,0.35)',
                            color: '#fcd34d',
                        }}
                    >
                        <Sparkles className="w-3 h-3" /> What's new
                    </div>
                    <h2 className="text-3xl sm:text-4xl font-bold text-white mb-2 font-serif tracking-tight">
                        Release notes
                    </h2>
                    <p className="text-sm" style={{ color: 'rgba(228,228,231,0.55)' }}>
                        v{release.version} · published {formatDate(release.publishedAt)}
                    </p>
                </div>

                <div
                    className="rounded-2xl p-7"
                    style={{
                        background:
                            'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
                        border: '1px solid rgba(255,255,255,0.07)',
                        boxShadow: '0 30px 60px -20px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)',
                    }}
                >
                    {renderNotes(release.body)}
                </div>
            </div>
        </section>
    )
}

function RequirementsSection() {
    const headingRef = useScrollReveal<HTMLDivElement>('fade-up', { start: 'top 88%' })

    const requirements: { os: UserOS; title: string; items: string[]; icon: React.ElementType; accent: string }[] = [
        {
            os: 'macos',
            title: 'macOS',
            items: ['macOS 10.13 (High Sierra) or later', 'Apple Silicon or Intel', '4 GB RAM minimum, 8 GB recommended', '~500 MB disk space'],
            icon: Apple,
            accent: '#a1a1aa',
        },
        {
            os: 'windows',
            title: 'Windows',
            items: ['Windows 10 (1809) or later', 'x64 or ARM64', '4 GB RAM minimum, 8 GB recommended', '~400 MB disk space'],
            icon: Monitor,
            accent: '#3b82f6',
        },
        {
            os: 'linux',
            title: 'Linux',
            items: ['glibc 2.31+ (Ubuntu 20.04, Fedora 32, etc.)', 'x86_64', 'Wayland or X11', '~450 MB disk space'],
            icon: Terminal,
            accent: '#f59e0b',
        },
    ]

    return (
        <section
            className="relative py-20 lg:py-28 overflow-hidden"
            style={{ background: '#0a0b10' }}
        >
            <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div ref={headingRef} className="text-center mb-12">
                    <div
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-4 text-[10px] font-bold uppercase tracking-[0.22em]"
                        style={{
                            background: 'linear-gradient(135deg, rgba(20,184,166,0.15) 0%, rgba(13,148,136,0.08) 100%)',
                            border: '1px solid rgba(20,184,166,0.35)',
                            color: '#5eead4',
                        }}
                    >
                        <Cpu className="w-3 h-3" /> System requirements
                    </div>
                    <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3 font-serif tracking-tight">
                        What you'll need
                    </h2>
                    <p className="text-base max-w-xl mx-auto" style={{ color: 'rgba(228,228,231,0.6)' }}>
                        Selah is light. If you can run a modern web browser, you can run Selah.
                    </p>
                </div>

                <div className="grid md:grid-cols-3 gap-5">
                    {requirements.map((req) => (
                        <div
                            key={req.os}
                            className="rounded-2xl p-6"
                            style={{
                                background:
                                    'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
                                border: '1px solid rgba(255,255,255,0.07)',
                                backdropFilter: 'blur(10px)',
                            }}
                        >
                            <div
                                className="w-11 h-11 rounded-2xl flex items-center justify-center mb-4"
                                style={{
                                    background: `${req.accent}18`,
                                    border: `1px solid ${req.accent}30`,
                                    color: req.accent,
                                }}
                            >
                                <req.icon className="w-5 h-5" />
                            </div>
                            <h3 className="text-lg font-semibold text-white mb-3">{req.title}</h3>
                            <ul className="space-y-2">
                                {req.items.map((item) => (
                                    <li
                                        key={item}
                                        className="flex items-start gap-2 text-sm text-white/65"
                                    >
                                        <Check
                                            className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"
                                            style={{ color: req.accent }}
                                        />
                                        <span>{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}

function VerifySection({ release }: { release: ReturnType<typeof useLatestRelease>['release'] }) {
    const headingRef = useScrollReveal<HTMLDivElement>('fade-up', { start: 'top 88%' })
    if (!release) return null
    return (
        <section
            className="relative py-20 lg:py-28 overflow-hidden"
            style={{ background: '#08090c' }}
        >
            <div
                className="absolute inset-0 pointer-events-none opacity-40"
                style={{
                    background:
                        'radial-gradient(ellipse 50% 50% at 20% 30%, rgba(20,184,166,0.10), transparent 60%)',
                }}
            />
            <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                <div ref={headingRef} className="mb-8">
                    <div
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-4 text-[10px] font-bold uppercase tracking-[0.22em]"
                        style={{
                            background: 'linear-gradient(135deg, rgba(20,184,166,0.15) 0%, rgba(13,148,136,0.08) 100%)',
                            border: '1px solid rgba(20,184,166,0.35)',
                            color: '#5eead4',
                        }}
                    >
                        <ShieldCheck className="w-3 h-3" /> Verification
                    </div>
                    <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3 font-serif tracking-tight">
                        Trust the bytes
                    </h2>
                    <p className="text-base max-w-xl" style={{ color: 'rgba(228,228,231,0.6)' }}>
                        Every bundle ships with a Tauri-generated signature that the in-app
                        updater verifies before applying any patch. Power users can verify
                        the signatures manually using the matching <code className="font-mono text-primary-300">.sig</code> files.
                    </p>
                </div>

                <div
                    className="rounded-2xl p-6"
                    style={{
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.07)',
                    }}
                >
                    <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-primary-300" />
                        Detached signatures
                    </h3>
                    {release.signatures.length === 0 ? (
                        <p className="text-sm text-white/45">
                            No detached signatures were published with this release. (The
                            in-app updater still verifies bundles against the embedded public
                            key, so this is only needed for offline verification.)
                        </p>
                    ) : (
                        <div className="space-y-1.5">
                            {release.signatures.map((sig) => (
                                <div
                                    key={sig.url}
                                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg"
                                    style={{ background: 'rgba(0,0,0,0.25)' }}
                                >
                                    <code className="text-xs font-mono text-white/70 truncate" title={sig.fileName}>
                                        {sig.fileName}
                                    </code>
                                    <div className="flex items-center gap-3 flex-shrink-0">
                                        <span className="text-[10px] font-mono text-white/40">
                                            {formatBytes(sig.size)}
                                        </span>
                                        <CopyButton value={sig.url} label="Copy" />
                                        <a
                                            href={sig.url}
                                            className="text-[10px] font-mono uppercase tracking-widest text-primary-300 hover:text-primary-200"
                                        >
                                            Download
                                        </a>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div
                    className="mt-5 rounded-2xl p-5 flex items-start gap-3"
                    style={{
                        background:
                            'linear-gradient(135deg, rgba(20,184,166,0.08) 0%, rgba(20,184,166,0.02) 100%)',
                        border: '1px solid rgba(20,184,166,0.2)',
                    }}
                >
                    <RefreshCw className="w-5 h-5 text-primary-300 flex-shrink-0 mt-0.5" />
                    <div>
                        <h4 className="text-sm font-semibold text-white mb-1">
                            Updates happen in the background
                        </h4>
                        <p className="text-sm text-white/65 leading-relaxed">
                            Once Selah is installed, it checks for new releases on launch and
                            downloads signed updates in the background. You pick when to
                            restart — never mid-service.
                        </p>
                    </div>
                </div>
            </div>
        </section>
    )
}

function Footer() {
    return (
        <footer
            className="relative py-12 border-t"
            style={{ background: '#08090c', borderColor: 'rgba(255,255,255,0.05)' }}
        >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-2.5">
                    <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center"
                        style={{ background: 'linear-gradient(135deg, #14b8a6, #0d9488)' }}
                    >
                        <BookOpen className="w-3.5 h-3.5 text-white" strokeWidth={2.25} />
                    </div>
                    <span
                        style={{ fontFamily: 'Crimson Pro, serif', fontSize: '1rem', fontWeight: 600 }}
                        className="text-white"
                    >
                        Selah
                    </span>
                </div>
                <div className="flex items-center gap-5 text-xs text-white/45">
                    <a
                        href={RELEASES_PAGE}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-white transition-colors inline-flex items-center gap-1.5"
                    >
                        <Github className="w-3.5 h-3.5" /> Releases
                    </a>
                    <Link to="/" className="hover:text-white transition-colors">
                        Back to overview
                    </Link>
                    <span className="font-mono uppercase tracking-widest text-[10px]">
                        © {new Date().getFullYear()} Selah
                    </span>
                </div>
            </div>
        </footer>
    )
}

/* ----------------------------- Page ------------------------------------- */

export default function Downloads() {
    const [scrolled, setScrolled] = useState(false)
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
    const { status, release, error } = useLatestRelease()
    const userPlatform = useMemo(() => detectPlatform(), [])
    const [retryNonce, setRetryNonce] = useState(0)

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 16)
        onScroll()
        window.addEventListener('scroll', onScroll, { passive: true })
        return () => window.removeEventListener('scroll', onScroll)
    }, [])

    // Re-fetch on retry by forcing a state change that the hook could
    // (in a future iteration) react to. For now the hook runs once,
    // so we simply reload the page on retry — preserves a stable contract.
    const retry = () => {
        setRetryNonce((n) => n + 1)
        window.location.reload()
    }
    // retryNonce kept for future use; the in-flight request uses the
    // initial mount effect.
    void retryNonce

    return (
        <div className="dark min-h-screen flex flex-col selection:bg-primary-500/30">
            <NavBar
                scrolled={scrolled}
                mobileMenuOpen={mobileMenuOpen}
                setMobileMenuOpen={setMobileMenuOpen}
            />
            <main className="flex-1">
                <HeroSection release={release} error={status === 'error' ? error : null} retry={retry} />
                <PlatformsSection release={release} detected={userPlatform} />
                <ReleaseNotesSection release={release} />
                <RequirementsSection />
                <VerifySection release={release} />
            </main>
            <Footer />
        </div>
    )
}
