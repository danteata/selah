/**
 * HeardVersesStrip — on the phone's live screen, the verses the session's
 * sermon listener just heard (it runs on the desk's computer), each a tap from
 * the screen: Live for whoever may put slides up, Suggest for a contributor
 * whose suggestions the operator reviews. Nothing shows outside a session or
 * before anything's been heard.
 */

import { useCallback, useEffect, useState } from 'react'
import { Ear, Lightbulb, Loader2, Play, Check } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useScripture } from '../../hooks/useScripture'
import { useSlideCreation } from '../../hooks/useSlideCreation'
import { useGoLive } from '../../hooks/useGoLive'
import { useLiveSession } from '../../hooks/useLiveSession'
import { verseToLabel } from '../../services/sermon-listener/verseDetection'
import { heardAgo } from '../../services/sermon-listener/heardVerses'
import type { HeardVerse } from '../../types'

/** Rows shown: the newest few are the ones anyone reaches for. */
const SHOWN = 3

export function HeardVersesStrip({ canControlLive, canSuggest }: { canControlLive: boolean; canSuggest: boolean }) {
    const heard = useAppStore((s) => s.sessionHeardVerses)
    const defaultBibleVersion = useAppStore((s) => s.settings.defaultBibleVersion)
    const appendActiveSlide = useAppStore((s) => s.appendActiveSlide)
    const { fetchScripture } = useScripture()
    const { createBibleSlide } = useSlideCreation()
    const { addAndGoLive } = useGoLive()
    const { isConnected, addToQueue } = useLiveSession()
    const [busy, setBusy] = useState<string | null>(null)
    const [sent, setSent] = useState<Set<string>>(new Set())
    const [now, setNow] = useState(() => Date.now())

    // "40s ago" keeps up without re-rendering every second.
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 15_000)
        return () => clearInterval(timer)
    }, [])

    const send = useCallback(async (verse: HeardVerse) => {
        const label = verseToLabel(verse)
        if (!label) return
        setBusy(verse.reference)
        try {
            // The listener's translation, so the phone shows what the desk would.
            const scripture = await fetchScripture(label, verse.version || defaultBibleVersion)
            if (!scripture) return
            // Built like any other verse here, so it takes the session's
            // default template — the operator's house style.
            const slide = createBibleSlide(scripture)
            if (canControlLive) {
                addAndGoLive([slide])
            } else {
                appendActiveSlide(slide)
                await addToQueue([slide.id])
            }
            setSent((prev) => new Set(prev).add(verse.reference))
        } finally {
            setBusy(null)
        }
    }, [fetchScripture, defaultBibleVersion, createBibleSlide, canControlLive, addAndGoLive, appendActiveSlide, addToQueue])

    if (!isConnected || heard.length === 0) return null
    const action = canControlLive ? 'live' : canSuggest ? 'suggest' : null

    return (
        <section className="px-4 pt-5" aria-labelledby="mobile-heard">
            <h2 id="mobile-heard" className="mobile-section-label mb-2 flex items-center gap-1.5">
                <Ear className="w-3.5 h-3.5" />
                Heard just now
            </h2>
            <ul className="space-y-1.5">
                {heard.slice(0, SHOWN).map((verse) => {
                    const isBusy = busy === verse.reference
                    const wasSent = sent.has(verse.reference)
                    return (
                        <li key={verse.reference} className="flex items-center gap-2 pl-3.5 pr-1.5 py-1.5 rounded-xl bg-[var(--accent-amber)]/8 border border-[var(--accent-amber)]/20">
                            <span className="flex-1 min-w-0">
                                <span className="block text-[15px] text-[var(--text-primary)] truncate">{verse.reference}</span>
                                <span className="block text-xs text-[var(--text-muted)]">
                                    {heardAgo(verse.heardAt, now)}{verse.version ? ` · ${verse.version}` : ''}
                                </span>
                            </span>
                            {action && (
                                <button
                                    type="button"
                                    onClick={() => void send(verse)}
                                    disabled={isBusy}
                                    aria-label={`${action === 'live' ? 'Go live' : 'Suggest'}: ${verse.reference}`}
                                    className={`h-11 min-w-11 px-3.5 flex items-center justify-center gap-1.5 rounded-full text-sm font-semibold text-white active:scale-95 transition-transform disabled:opacity-60 ${action === 'live' ? 'bg-[var(--accent-teal)]' : 'bg-blue-600'}`}
                                >
                                    {isBusy
                                        ? <Loader2 className="w-4 h-4 animate-spin" />
                                        : wasSent
                                            ? <Check className="w-4 h-4" />
                                            : action === 'live' ? <Play className="w-4 h-4" /> : <Lightbulb className="w-4 h-4" />}
                                    {action === 'live' ? 'Live' : 'Suggest'}
                                </button>
                            )}
                        </li>
                    )
                })}
            </ul>
        </section>
    )
}
