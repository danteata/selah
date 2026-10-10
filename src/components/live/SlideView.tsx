import { MotionCanvas } from '../motion/MotionCanvas'
import { motionBackgroundFor } from '../motion/motionBackgrounds'
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Slide, SlideStyle } from '../../types'
import { slideTypes, backgroundTypes } from '../../types'
import { useSlideBackgroundUrl } from '../../hooks/useSlideBackgroundUrl'
import { audioFeatures } from '../../services/visualizer/audioFeatures'
import { getVerseRefStyle, VERSE_REF_BOUNDS, type ClampBase } from '../../utils/verseRefStyle'
import { isCaptionedSlideType, slideCaptionHtml } from '../../utils/slideCaption'
import { countdownDurationSeconds, formatCountdownTime, useCountdownSeconds } from '../../utils/countdown'
import { slideBackgroundFilter } from '../../utils/slideBackground'
import { slideBodyHtml } from '../../utils/slideHtml'
import { cssFontStack } from '../../lib/fonts'
import { isTextBuildInPreset, wrapUnits, type TextAnimation } from '../../lib/animation/textBuildIn'
import { prefersReducedMotion, useTextBuildIn } from '../../hooks/useTextBuildIn'
import { wrapWords } from '../../lib/animation/wordMorph'
import { useWordMorph } from '../../hooks/useWordMorph'
import { AutoFitText } from './AutoFitText'
import { KineticText } from './KineticText'
import { VideoBackground } from './VideoBackground'
import { MediaContent, type MediaProgress } from './MediaContent'
import { AudioReactiveBackground } from './AudioReactiveBackground'
import { LocalMediaPlaceholder } from '../slides/LocalMediaPlaceholder'

/**
 * A slide, drawn the way the projector draws it, at any size.
 *
 * The projector (LiveView), the operator's Program Output monitor, its Next Up
 * preview and the mobile studio each had their own copy of this, and they had
 * drifted: the monitor dropped a countdown's title and "Time's up", ignored
 * window padding and the song title, drew verse references at a third of the
 * projector's size, and captioned only Bible slides. The operator was
 * approving a picture the congregation never saw.
 *
 * Everything is sized against a 1920px-wide frame, in container units: the
 * root is a size container, and `--slide-u` is one pixel of that frame. On a
 * full-screen 1920px projector the result is what it always was; anywhere
 * smaller it's the same picture, scaled.
 */

/** The width, in px, that every size here is written against. */
const FRAME_WIDTH = 1920

/** The display settings a slide is drawn with (see useLiveOutputSettings). */
export interface SlideViewSettings {
    defaultFont?: string
    songAndHymnLabelsVisibility?: boolean
    verseRefPosition?: 'top' | 'bottom'
    verseRefColor?: string
    verseRefBold?: boolean
    verseRefItalic?: boolean
    verseRefUnderline?: boolean
    verseRefSizePercent?: number
    animations?: boolean
    transitionInterval?: number
    /** How text slides change: a fade, or shared words gliding to their new place. */
    slideTransition?: 'fade' | 'morph'
    visualizerEnabled?: boolean
    /** "Clear": the background stays, the text and media go. */
    liveOutputBlanked?: boolean
}

interface SlideViewProps {
    slide: Slide
    settings: SlideViewSettings
    /** A resolved background, when the caller already has one. */
    backgroundUrl?: string | null
    /** Fade between slides. Off for thumbnails that shouldn't animate. */
    animate?: boolean
    /** Media plays silently (operator previews). */
    muted?: boolean
    onMediaProgress?: (state: MediaProgress) => void
    /**
     * Show a placeholder for media this device can't load. Operator-facing
     * only: the audience should never see it.
     */
    showMissingMedia?: boolean
    /**
     * Smallest body text in px, so a thumbnail stays readable. 0 keeps the
     * projector's proportions exactly.
     */
    minTextPx?: number
    /**
     * Run a countdown's clock. Off for previews of a slide that isn't live
     * (Next Up): they show the full time instead of counting down early.
     */
    clock?: boolean
    className?: string
    /** Drawn above the slide, outside its transitions (operator controls). */
    children?: ReactNode
}

/** `n` pixels of the 1920px frame. */
const u = (n: number) => `calc(${n} * var(--slide-u))`

/** A caption's clamp() bounds, rescaled from the full-screen frame to this one. */
function scaledBounds(base: ClampBase, scale: number, floorPx: number): ClampBase {
    return {
        minPx: Math.max(floorPx, base.minPx * scale),
        coefficient: base.coefficient,
        unit: 'cqw',
        maxPx: Math.max(floorPx, base.maxPx * scale),
    }
}

function lowerThirdBar(style: SlideStyle | undefined): CSSProperties {
    const accent = style?.lowerThirdAccentColor || '#0d9488'
    switch (style?.lowerThirdStyle) {
        case 'minimalist':
            return { background: 'transparent' }
        case 'accent-bar':
            return {
                background: 'rgba(0, 0, 0, 0.75)',
                backdropFilter: `blur(${u(12)})`,
                borderLeft: `max(2px, ${u(6)}) solid ${accent}`,
            }
        case 'gradient-bar':
            return {
                background: `linear-gradient(135deg, ${accent}ee, ${accent}88)`,
                backdropFilter: `blur(${u(12)})`,
            }
        default:
            return { background: 'rgba(0, 0, 0, 0.75)', backdropFilter: `blur(${u(12)})` }
    }
}

export function SlideView({
    slide,
    settings,
    backgroundUrl: providedBackground,
    animate = true,
    muted,
    onMediaProgress,
    showMissingMedia = false,
    minTextPx = 0,
    clock = true,
    className = '',
    children,
}: SlideViewProps) {
    const resolvedBackground = useSlideBackgroundUrl(providedBackground === undefined ? slide : null)
    const backgroundUrl = providedBackground === undefined ? resolvedBackground : providedBackground
    const runningSeconds = useCountdownSeconds(clock ? slide : null)
    const countdownSeconds = clock ? runningSeconds : countdownDurationSeconds(slide)

    // AutoFitText's bounds are pixels, so they scale with the frame too.
    const rootRef = useRef<HTMLDivElement>(null)
    // Held in state as well, for the morph overlay: its effect has to run once
    // the frame exists.
    const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null)
    const setRoot = useCallback((el: HTMLDivElement | null) => {
        rootRef.current = el
        setFrameEl(el)
    }, [])
    const [width, setWidth] = useState(0)
    useLayoutEffect(() => {
        const el = rootRef.current
        if (!el) return
        setWidth(el.clientWidth)
        if (typeof ResizeObserver === 'undefined') return
        const ro = new ResizeObserver(() => setWidth(el.clientWidth))
        ro.observe(el)
        return () => ro.disconnect()
    }, [])
    const scale = width > 0 ? width / FRAME_WIDTH : 1
    const px = (n: number) => Math.max(minTextPx, n * scale)
    const captionFloor = minTextPx * 0.7

    const font = cssFontStack(slide.slideStyle?.font || settings.defaultFont)
    // A sung line stays on one line: the text shrinks to fit the longest one
    // instead of filling the screen and stranding a word ("me") on a line of
    // its own. The verse's own line breaks still apply.
    const keepLines = slide.type === slideTypes.song || slide.type === slideTypes.hymn
    const bodyWhiteSpace = keepLines ? ('nowrap' as const) : undefined
    const visualizer = settings.visualizerEnabled ?? false
    const transition = animate && settings.animations !== false ? '' : 'no-transition'
    const transitionSeconds = settings.transitionInterval ?? 0.7

    // Read the beat pulse once, when the slide changes: a change landing on a
    // beat gets a punchier entrance than the plain fade.
    const isBeatTransition = useMemo(
        () => visualizer && audioFeatures.beatPulse > 0.5,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [slide.id]
    )

    // A lower third's title (and caption) can build in letter by letter or word
    // by word. Only where the slide animates at all: never in thumbnails, the
    // Next Up preview, with animations off, or for a viewer who asked for less
    // motion. Text that won't animate is never wrapped, because the wrapped
    // units start hidden.
    const storedAnimation = slide.slideStyle?.textAnimation
    const textAnimation: TextAnimation | null =
        slide.layout === 'lower-third' && animate && settings.animations !== false
            && isTextBuildInPreset(storedAnimation?.preset) && !prefersReducedMotion()
            ? storedAnimation ?? null
            : null
    const buildInPreset = textAnimation?.preset
    const lowerThirdBodyHtml = useMemo(() => {
        const html = slideBodyHtml(slide.contents[0])
        return buildInPreset ? wrapUnits(html, buildInPreset) : html
    }, [slide.contents, buildInPreset])
    const [lowerThirdEl, setLowerThirdEl] = useState<HTMLDivElement | null>(null)
    useTextBuildIn(lowerThirdEl, textAnimation, `${slide.id}:${lowerThirdBodyHtml}`)

    const isMedia = slide.type === slideTypes.media
    const motion = motionBackgroundFor(slide.background)

    // Word morph (settings → "Word morph"): a text slide's words glide from
    // where they were on the previous slide. Only where the slide animates at
    // all, not under the beat-reactive visualizer (it scales the text, which
    // throws off the measuring), and only for full-text slides; lower thirds,
    // countdowns and media keep the fade.
    const morphMode = settings.slideTransition === 'morph' && transition === '' && !visualizer
        && !isMedia && slide.layout !== 'lower-third' && slide.type !== 'countdown'
        && !prefersReducedMotion()
    const bodyHtml = useMemo(() => {
        const html = slideBodyHtml(slide.contents[0])
        return morphMode ? wrapWords(html) : html
    }, [slide.contents, morphMode])
    const [morphBody, setMorphBody] = useState<HTMLDivElement | null>(null)
    useWordMorph(frameEl, morphBody, { enabled: morphMode, slideId: slide.id, seconds: transitionSeconds })
    const isVideoBackground = !motion && slide.backgroundType === 'video' && !!backgroundUrl
    // Per-slide setting wins, then the global default, then bottom.
    const refPosition = slide.slideStyle?.verseRefPosition ?? settings.verseRefPosition ?? 'bottom'

    const renderContent = () => {
        if (isMedia) {
            if (showMissingMedia && slide.backgroundType !== backgroundTypes.external && !backgroundUrl) {
                return <LocalMediaPlaceholder backgroundType={slide.backgroundType} />
            }
            return (
                <MediaContent
                    slide={slide}
                    src={backgroundUrl || undefined}
                    muted={muted}
                    onProgress={onMediaProgress}
                    className="absolute inset-0 w-full h-full"
                />
            )
        }

        if (slide.layout === 'lower-third') {
            // Strip anchored to the bottom; the body auto-fits, the caption stays small.
            const captionHtml = slideCaptionHtml(slide)
            const subtitle = slide.slideStyle?.lowerThirdSubtitle || ''
            const captionOnTop = isCaptionedSlideType(slide.type) && refPosition === 'top'
            const position = slide.slideStyle?.lowerThirdPosition
            const alignItems = position === 'center' ? 'center' : position === 'right' ? 'flex-end' : 'flex-start'
            const textAlign = (position as 'left' | 'center' | 'right') || 'left'

            // The subtitle is plain text; as markup it can be wrapped for the build-in too.
            const captionMarkup = captionHtml || (subtitle && escapeHtml(subtitle))
            const captionNode = captionMarkup && (
                <div
                    className="shrink-0 drop-shadow-lg"
                    style={{
                        fontFamily: font,
                        lineHeight: 1.25,
                        letterSpacing: '0.02em',
                        width: '100%',
                        textAlign,
                        ...getVerseRefStyle(slide.slideStyle, settings, scaledBounds(VERSE_REF_BOUNDS.lowerThird, scale, captionFloor)),
                    }}
                    // The Bible reference is HTML so its <b> book title renders.
                    dangerouslySetInnerHTML={{ __html: buildInPreset ? wrapUnits(captionMarkup, buildInPreset) : captionMarkup }}
                />
            )

            return (
                <div ref={setLowerThirdEl} className="absolute inset-x-0 bottom-0" style={{ height: '30cqh' }}>
                    <div
                        className="w-full h-full flex flex-col"
                        style={{ alignItems, padding: `${u(20)} ${u(48)}`, gap: u(8), ...lowerThirdBar(slide.slideStyle) }}
                    >
                        {captionOnTop && captionNode}
                        <KineticText enabled={visualizer} className="w-full flex-1 min-h-0">
                            <AutoFitText
                                html={lowerThirdBodyHtml}
                                className="w-full h-full text-white drop-shadow-lg tiptap-preview"
                                minPx={px(18)}
                                maxPx={px(160)}
                                style={{ fontFamily: font, textAlign, fontWeight: 600, lineHeight: 1.2, whiteSpace: bodyWhiteSpace }}
                            />
                        </KineticText>
                        {!captionOnTop && captionNode}
                    </div>
                </div>
            )
        }

        if (slide.type === 'countdown') {
            return (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    {slide.contents[0] && (
                        <div
                            className="text-white/80 drop-shadow-lg text-center"
                            style={{
                                fontSize: '4cqw',
                                marginBottom: u(24),
                                fontFamily: font,
                                fontWeight: 400,
                                letterSpacing: '0.04em',
                            }}
                        >
                            {slide.contents[0]}
                        </div>
                    )}
                    <div
                        className="text-white drop-shadow-2xl font-mono font-bold tabular-nums"
                        style={{
                            fontSize: '20cqw',
                            fontFamily: cssFontStack(slide.slideStyle?.font || 'monospace'),
                            lineHeight: 1,
                            letterSpacing: '-0.02em',
                            textShadow: '0 4px 32px rgba(0,0,0,0.6)',
                        }}
                    >
                        {formatCountdownTime(countdownSeconds)}
                    </div>
                    {countdownSeconds === 0 && (
                        <div
                            className="text-white/60 text-center"
                            style={{ fontSize: '3cqw', marginTop: u(32), fontFamily: font }}
                        >
                            Time's up!
                        </div>
                    )}
                </div>
            )
        }

        // Centred: the body fills the frame, references pinned above or below.
        const hasRef = slide.contents.length > 1
        const refStyle: CSSProperties = {
            fontFamily: font,
            lineHeight: 1.05,
            letterSpacing: '0.01em',
            textShadow: slide.slideStyle?.textOutlined ? '1px 1px 3px rgba(0,0,0,0.8)' : undefined,
            ...getVerseRefStyle(slide.slideStyle, settings, scaledBounds(VERSE_REF_BOUNDS.fullSlide, scale, captionFloor)),
        }
        const refs = slide.contents.slice(1).map((ref, i) => (
            <div key={i} dangerouslySetInnerHTML={{ __html: ref }} />
        ))
        const padding = slide.slideStyle?.windowPadding
        // While the body morphs, the layer itself doesn't fade, so the references do.
        const refTransition = morphMode ? 'studio-slide-transition' : ''
        return (
            <div
                className="absolute inset-0 flex flex-col"
                style={{
                    paddingLeft: u(padding?.left ?? 32),
                    paddingRight: u(padding?.right ?? 32),
                    paddingTop: u(padding?.top ?? 32),
                    paddingBottom: u(padding?.bottom ?? 32),
                }}
            >
                {hasRef && refPosition === 'top' && (
                    <div className={`shrink-0 text-center drop-shadow-lg ${refTransition}`} style={{ ...refStyle, paddingBottom: u(12) }}>
                        {refs}
                    </div>
                )}
                <KineticText enabled={visualizer} className="flex-1 min-h-0">
                    <div ref={setMorphBody} className="w-full h-full">
                        <AutoFitText
                            html={bodyHtml}
                            className="w-full h-full text-white drop-shadow-lg tiptap-preview"
                            minPx={px(24)}
                            maxPx={px(640)}
                            style={{
                                fontFamily: font,
                                textAlign: (slide.slideStyle?.alignment as 'left' | 'center' | 'right') || 'center',
                                textTransform: (slide.slideStyle?.lettercase as 'uppercase' | 'lowercase' | 'capitalize' | 'none') || 'none',
                                lineHeight: 1.0,
                                whiteSpace: bodyWhiteSpace,
                                textShadow: slide.slideStyle?.textOutlined ? '2px 2px 4px rgba(0,0,0,0.8)' : undefined,
                            }}
                        />
                    </div>
                </KineticText>
                {hasRef && refPosition !== 'top' && (
                    <div className={`shrink-0 text-center drop-shadow-lg ${refTransition}`} style={{ ...refStyle, paddingTop: u(12) }}>
                        {refs}
                    </div>
                )}
            </div>
        )
    }

    return (
        <div
            ref={setRoot}
            // A caller that positions the frame itself (absolute/fixed) must win:
            // with both classes, CSS order made it relative, and a relative
            // size container with no height is 0px tall. That blanked the
            // projector entirely in 0.1.23.
            className={`${/\b(absolute|fixed)\b/.test(className) ? '' : 'relative '}overflow-hidden bg-black ${className}`}
            style={{
                containerType: 'size',
                '--studio-transition-duration': `${isBeatTransition ? Math.min(transitionSeconds, 0.35) : transitionSeconds}s`,
            } as CSSProperties}
        >
            <div className="absolute inset-0" style={{ '--slide-u': `calc(100cqw / ${FRAME_WIDTH})` } as CSSProperties}>
                {/* The background is keyed by its source, not the slide, so a
                    song's motion background doesn't restart (and flash black)
                    on each of its slides. */}
                <div
                    key={isMedia ? 'media' : (backgroundUrl || 'none')}
                    className={`absolute inset-0 studio-slide-transition ${transition}`}
                >
                    {isMedia ? (
                        // Media is the content itself, not a backdrop for text: no dimming.
                        <div className="absolute inset-0 bg-black" />
                    ) : motion ? (
                        <MotionCanvas
                            background={motion}
                            className="absolute inset-0"
                            style={{ filter: slideBackgroundFilter(slide) }}
                        />
                    ) : isVideoBackground && backgroundUrl ? (
                        <VideoBackground
                            src={backgroundUrl}
                            className="absolute inset-0 w-full h-full object-cover"
                            style={{ filter: slideBackgroundFilter(slide) }}
                        />
                    ) : backgroundUrl ? (
                        <div
                            className="absolute inset-0 bg-cover bg-center"
                            style={{ backgroundImage: `url(${backgroundUrl})`, filter: slideBackgroundFilter(slide) }}
                        />
                    ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-gray-900 to-black" />
                    )}
                </div>

                {/* Audio-reactive motion, behind the text. Never remounts. */}
                <AudioReactiveBackground enabled={visualizer} />

                <div
                    key={slide.id}
                    // A morph moves the words itself; the layer doesn't fade on top of it.
                    className={`absolute inset-0 studio-slide-transition ${morphMode ? 'no-transition' : transition} ${isBeatTransition && !morphMode ? 'beat-punch' : ''}`}
                >
                    {/* "Clear" hides the text and media but keeps the
                        background, so the room can see the output is live. */}
                    {!settings.liveOutputBlanked && renderContent()}
                    {!settings.liveOutputBlanked && slide.title && settings.songAndHymnLabelsVisibility && (
                        <div
                            className="absolute text-white/80"
                            style={{ top: u(32), left: u(32), fontSize: `max(8px, ${u(18)})` }}
                        >
                            {slide.title}
                        </div>
                    )}
                </div>

                {children}
            </div>
        </div>
    )
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
