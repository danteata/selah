import { useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import { useAnalytics } from './useAnalytics'
import { AnalyticsEventType } from '../services/analytics/types'
import { resolveLocalUrl, stripEphemeralBackground } from './useLocalBackground'
import type {
    Slide,
    Scripture,
    Hymn,
    Song,
    Countdown,
    DictionaryEntry,
    DictionaryPack,
    ExtendedFileT,
    ExternalVideo,
    SlideStyle
} from '../types'
import { formatHeadword } from '../lib/search/dictionarySearch'
import {
    slideTypes,
    slideLayoutTypes,
    backgroundTypes,
    backgroundFillTypes
} from '../types'
import { saveMedia } from './useIndexedDB'
import type { TemplateItem } from './useTemplates'
import { useTemplates } from './useTemplates'
import { sectionsForSong } from '../lib/songSections'

function applyTemplateToSlide(tempSlide: Slide, template: TemplateItem | null, defaultBg: string, defaultBgType: string, defaultBgVideoKey?: string): void {
    if (!template) {
        tempSlide.background = defaultBg
        tempSlide.backgroundType = defaultBgType
        tempSlide.backgroundVideoKey = defaultBgVideoKey || null
        return
    }

    let templateSlide: Partial<Slide> | null = null
    if (typeof template.slideId === 'string') {
        try { templateSlide = JSON.parse(template.slideId) } catch { /* ignore */ }
    } else if (typeof template.slideId === 'object' && template.slideId !== null) {
        templateSlide = template.slideId as Partial<Slide>
    }
    // Templates saved by an earlier session may carry a dead blob: URL. Drop it
    // so the fallbacks below apply instead of rendering an unresolvable URL.
    templateSlide = stripEphemeralBackground(templateSlide)

    if (templateSlide) {
        tempSlide.background = resolveLocalUrl(templateSlide.background || defaultBg, templateSlide.localFilePath) || defaultBg
        tempSlide.backgroundType = templateSlide.backgroundType || defaultBgType
        tempSlide.backgroundStorageId = templateSlide.backgroundStorageId || null
        tempSlide.backgroundVideoKey = templateSlide.backgroundVideoKey || null
        tempSlide.localFilePath = templateSlide.localFilePath || undefined
        // Layout determines fundamental rendering (e.g. lower-third vs full-text). A template that
        // declares a non-default layout should propagate it to the new slide.
        if (templateSlide.layout) {
            tempSlide.layout = templateSlide.layout
        }
        if (templateSlide.slideStyle) {
            tempSlide.slideStyle = { ...tempSlide.slideStyle, ...templateSlide.slideStyle }
        }
    } else {
        tempSlide.background = defaultBg
        tempSlide.backgroundType = defaultBgType
        tempSlide.backgroundVideoKey = defaultBgVideoKey || null
    }
}

// Generate a unique ObjectID-style ID
export function generateObjectId(): string {
    const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0')
    const machineId = Math.floor(Math.random() * 16777216).toString(16).padStart(6, '0')
    const processId = Math.floor(Math.random() * 65536).toString(16).padStart(4, '0')
    const counter = Math.floor(Math.random() * 16777216).toString(16).padStart(6, '0')
    return timestamp + machineId + processId + counter
}

// For an auto-detected multi-verse range, only the first verse should be
// displayed by default (a full range crammed onto one slide is illegible) —
// returns undefined for a single-verse scripture so callers render it in full.
export function firstVerseOnly(scripture: Scripture): number[] | undefined {
    if (!Array.isArray(scripture.content) || scripture.content.length <= 1) return undefined
    return [Number(scripture.content[0].verse)]
}

/**
 * How much definition text goes on one slide before it stops being readable
 * from the back row. Easton's entries run to 2,000+ characters — a single
 * slide would render them at ~14px on a projector.
 */
export const DEFINITION_CHARS_PER_SLIDE = 320

/**
 * Split a definition into projectable chunks at sentence boundaries.
 *
 * Sentences are kept whole wherever possible — a definition broken mid-clause
 * reads as a mistake on screen. A sentence longer than the budget on its own
 * (Webster's has a few) is split at the last comma or space before the limit
 * rather than mid-word.
 */
export function chunkDefinitionText(text: string, maxChars = DEFINITION_CHARS_PER_SLIDE): string[] {
    const normalized = text.replace(/\s+/g, ' ').trim()
    if (!normalized) return []
    if (normalized.length <= maxChars) return [normalized]

    // Keep the delimiter with the sentence it ends.
    const sentences = normalized.match(/[^.!?;]+[.!?;]*\s*/g)?.map((s) => s.trim()).filter(Boolean)
        ?? [normalized]

    const chunks: string[] = []
    let current = ''

    const flush = () => {
        if (current) chunks.push(current)
        current = ''
    }

    for (const sentence of sentences) {
        if (sentence.length > maxChars) {
            flush()
            chunks.push(...splitOversizedSentence(sentence, maxChars))
            continue
        }
        if (!current) {
            current = sentence
        } else if (current.length + 1 + sentence.length <= maxChars) {
            current = `${current} ${sentence}`
        } else {
            flush()
            current = sentence
        }
    }
    flush()

    return chunks
}

/** Break a single over-long sentence at the last comma, else the last space. */
function splitOversizedSentence(sentence: string, maxChars: number): string[] {
    const parts: string[] = []
    let rest = sentence

    while (rest.length > maxChars) {
        const window = rest.slice(0, maxChars)
        const breakAt = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '))
        const cut = breakAt > maxChars * 0.5
            ? breakAt + 1
            : window.lastIndexOf(' ') > 0 ? window.lastIndexOf(' ') : maxChars
        parts.push(rest.slice(0, cut).trim())
        rest = rest.slice(cut).trim()
    }
    if (rest) parts.push(rest)

    return parts
}

/**
 * The label under a definition: the headword, its original-language forms for
 * a lexicon entry, and the pack it came from — the same role the reference
 * label plays on a Bible slide, and rendered in the same caption zone.
 */
export function buildDictionaryLabel(entry: DictionaryEntry, pack?: DictionaryPack | null): string {
    const parts: string[] = [`<b>${formatHeadword(entry.word)}</b>`]

    // The lemma is already the display word for lexicon entries, so only the
    // transliteration adds anything.
    if (entry.transliteration && entry.transliteration !== entry.word) {
        parts.push(`<span class="dictionary-translit">${entry.transliteration}</span>`)
    }

    const source = [pack?.shortName, entry.strongs].filter(Boolean).join(' ')
    const suffix = source ? ` · <span class="dictionary-source">${source}</span>` : ''

    return `<p class="dictionary-label">${parts.join(' ')}${suffix}</p>`
}

/** The two-part contents of a dictionary slide: definition body, then label. */
export function buildDictionaryContents(
    entry: DictionaryEntry,
    text: string,
    pack?: DictionaryPack | null,
): string[] {
    return [
        `<p class="dictionary-definition">${text}</p>`,
        buildDictionaryLabel(entry, pack),
    ]
}

// Calculate font size based on screen and content
export function calculateScreenFontSize(content: string): number {
    const length = content?.length || 0
    if (length === 0) return 3.5
    if (length < 100) return 6
    if (length < 200) return 5
    if (length < 300) return 4
    if (length < 400) return 3.5
    if (length < 500) return 3
    if (length < 700) return 2.5
    return 2.2
}

// Generate slide content from data
export function generateSlideContent(
    slide: Slide,
    data?: Scripture | Hymn | Song | Countdown | ExtendedFileT,
    currentVerse?: string,
    displayVerseNumbers?: number[]
): string[] {
    if (!data) return slide.contents || []

    switch (slide.type) {
        case slideTypes.bible: {
            const scripture = data as Scripture
            const contents: string[] = []

            // Add scripture content
            if (typeof scripture.content === 'string') {
                contents.push(`<p class="scripture-content">${scripture.content}</p>`)
            } else if (Array.isArray(scripture.content)) {
                const versesToRender = displayVerseNumbers
                    ? scripture.content.filter((verse) => displayVerseNumbers.includes(Number(verse.verse)))
                    : scripture.content
                const versesText = versesToRender
                    .map((verse: { verse: string; scripture: string }) => `<sup>${verse.verse}</sup>${verse.scripture}`)
                    .join(' ')
                contents.push(`<p class="scripture-content">${versesText}</p>`)
            }

            // Add reference label with version
            contents.push(`<p class="scripture-label"><b>${scripture.label}</b> · ${scripture.version}</p>`)

            return contents
        }
        case slideTypes.hymn: {
            const hymn = data as Hymn
            if (currentVerse) {
                return [currentVerse]
            }
            return hymn.verses?.[0] ? [hymn.verses[0]] : []
        }
        case slideTypes.song: {
            const song = data as Song
            if (currentVerse) {
                return [currentVerse]
            }
            return song.verses?.[0] ? [song.verses[0]] : []
        }
        case slideTypes.countdown: {
            const countdown = data as Countdown
            return [countdown.content, countdown.timeLeft || countdown.time]
        }
        case slideTypes.media: {
            return []
        }
        default:
            return slide.contents || []
    }
}

// Generate slide name
export function generateSlideName(slide: Slide): string {
    if (slide.name && slide.name !== 'Untitled') return slide.name

    switch (slide.type) {
        case slideTypes.bible:
            return slide.title || 'Bible Slide'
        case slideTypes.dictionary:
            return slide.title ? `Define: ${slide.title}` : 'Definition'
        case slideTypes.hymn:
            return slide.title ? `Hymn: ${slide.title}` : 'Hymn Slide'
        case slideTypes.song:
            return slide.data ? `Song: ${(slide.data as Song).title}` : 'Song Slide'
        case slideTypes.media:
            return 'Media Slide'
        case slideTypes.countdown:
            return 'Countdown'
        default:
            return 'Text Slide'
    }
}

// Generate a simple ID
export function generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

export function useSlideCreation() {
    const activeSlides = useAppStore((state) => state.activeSlides)
    const settings = useAppStore((state) => state.settings)
    const activeSchedule = useAppStore((state) => state.activeSchedule)
    const appendActiveSlide = useAppStore((state) => state.appendActiveSlide)
    const { templates } = useTemplates()
    const { trackEvent } = useAnalytics()

    const preSlideCreation = useCallback((): Slide => {
        const tempSlide: Slide = {
            id: generateObjectId(),
            index: activeSlides.length,
            name: 'Untitled',
            type: slideTypes.text,
            layout: slideLayoutTypes.full_text,
            contents: [],
            userId: '', // Will be set by auth
            churchId: '', // Will be set by auth
            scheduleId: activeSchedule?._id || '',
            ...(settings.defaultBackground?.default && {
                backgroundType: settings.defaultBackground.default.backgroundType,
                background: settings.defaultBackground.default.background,
                backgroundVideoKey: settings.defaultBackground.default.backgroundVideoKey,
            }),
            slideStyle: {
                alignment: settings.slideStyles.alignment,
                fontSizePercent: settings.slideStyles.fontSizePercent,
                isMediaMuted: true,
                isMediaPlaying: false,
                lettercase: settings.slideStyles.lettercase,
                lineSpacing: settings.slideStyles.lineSpacing,
                textOutlined: settings.slideStyles.textOutlined,
            },
        }
        return tempSlide
    }, [activeSlides.length, settings, activeSchedule])

    const createTextSlide = useCallback((options?: { template?: TemplateItem | null }): Slide => {
        const tempSlide = preSlideCreation()

        let templateToUse: TemplateItem | null = null
        if (options?.template) {
            templateToUse = options.template
        } else if (settings.defaultTemplates?.text && templates) {
            templateToUse = templates.find(t => t._id === settings.defaultTemplates?.text) || null
        }

        applyTemplateToSlide(
            tempSlide,
            templateToUse,
            settings.defaultBackground.default?.background || settings.defaultBackground.text?.background,
            settings.defaultBackground.default?.backgroundType || settings.defaultBackground.text?.backgroundType,
        )

        tempSlide.slideStyle = {
            ...tempSlide.slideStyle,
            alignment: 'left'
        }
        tempSlide.id = generateObjectId()
        tempSlide.contents = ['']

        trackEvent(AnalyticsEventType.SLIDE_CREATED, {
            slide_type: 'text',
            source: options?.template ? 'template' : 'quick_action',
            has_template: !!templateToUse,
        })

        return tempSlide
    }, [preSlideCreation, settings, templates, trackEvent])

    const duplicateSlide = useCallback((slideToDuplicate?: Slide): Slide | null => {
        if (!slideToDuplicate) return null

        const tempSlide = { ...slideToDuplicate }
        delete (tempSlide as Record<string, unknown>)._id
        tempSlide.id = generateObjectId()

        trackEvent(AnalyticsEventType.SLIDE_CREATED, {
            slide_type: tempSlide.type || 'unknown',
            source: 'duplicate',
        })

        return tempSlide
    }, [trackEvent])

    const createBibleSlide = useCallback((
        scripture: Scripture,
        options?: { fromWholeBibleSearch?: boolean, template?: TemplateItem | null, displayVerseNumbers?: number[] }
    ): Slide => {
        const tempSlide = preSlideCreation()
        tempSlide.layout = slideLayoutTypes.bible
        tempSlide.type = slideTypes.bible

        let templateToUse: TemplateItem | null = null
        if (options?.template) {
            templateToUse = options.template
        } else if (settings.defaultTemplates?.scripture && templates) {
            templateToUse = templates.find(t => t._id === settings.defaultTemplates?.scripture) || null
        }

        applyTemplateToSlide(
            tempSlide,
            templateToUse,
            settings.defaultBackground.default?.background || settings.defaultBackground.bible?.background,
            settings.defaultBackground.default?.backgroundType || settings.defaultBackground.bible?.backgroundType,
            settings.defaultBackground.default?.backgroundVideoKey ?? settings.defaultBackground.bible?.backgroundVideoKey ?? undefined,
        )

        tempSlide.title = scripture?.label
        tempSlide.name = generateSlideName(tempSlide)

        const displayVerseNumbers = options?.displayVerseNumbers
        const versesForFontSize = Array.isArray(scripture?.content) && displayVerseNumbers
            ? scripture.content.filter((v) => displayVerseNumbers.includes(Number(v.verse)))
            : scripture?.content
        const contentString = typeof versesForFontSize === 'string'
            ? versesForFontSize
            : Array.isArray(versesForFontSize)
                ? versesForFontSize.map((v: { scripture: string }) => v.scripture).join(' ')
                : ''
        const fontSize = calculateScreenFontSize(contentString)

        tempSlide.slideStyle = {
            ...tempSlide.slideStyle,
            fontSize: Number(fontSize),
            bibleVersion: scripture.version,
        }
        tempSlide.data = scripture
        tempSlide.displayVerseNumbers = displayVerseNumbers
        tempSlide.contents = generateSlideContent(tempSlide, scripture, undefined, displayVerseNumbers)

        // Scripture has no top-level `book` field — derive from the first
        // BibleVerse in `content` (when array) or parse the leading word off
        // `label` (e.g. "John 3:16" -> "John"). Fall back to undefined.
        const bookFromContent = Array.isArray(scripture.content)
            ? scripture.content[0]?.book
            : undefined
        const bookFromLabel = scripture.label?.split(/\s+\d/)[0]?.trim() || undefined

        trackEvent(AnalyticsEventType.SLIDE_CREATED, {
            slide_type: 'bible',
            source: options?.fromWholeBibleSearch ? 'bible_search' : 'quick_action',
            version: scripture.version,
            book: bookFromContent ?? bookFromLabel,
            has_template: !!templateToUse,
        })

        return tempSlide
    }, [preSlideCreation, settings, templates, trackEvent])

    /**
     * One slide showing one chunk of a dictionary definition.
     *
     * Styled off the scripture defaults rather than the plain-text ones: a
     * definition sits in the same part of a service as a verse (it goes up
     * while the preacher is teaching), and operators expect it to match.
     */
    const createDictionarySlide = useCallback((
        entry: DictionaryEntry,
        text: string,
        options?: {
            pack?: DictionaryPack | null
            template?: TemplateItem | null
            /** 0-based position within the definition, for the "Part 2 of 3" label. */
            partIndex?: number
            totalParts?: number
        }
    ): Slide => {
        const tempSlide = preSlideCreation()
        tempSlide.layout = slideLayoutTypes.bible
        tempSlide.type = slideTypes.dictionary

        let templateToUse: TemplateItem | null = null
        if (options?.template) {
            templateToUse = options.template
        } else if (settings.defaultTemplates?.dictionary && templates) {
            templateToUse = templates.find(t => t._id === settings.defaultTemplates?.dictionary) || null
        } else if (settings.defaultTemplates?.scripture && templates) {
            // No dictionary-specific default set — fall back to the scripture
            // template so definitions match the verses they sit beside.
            templateToUse = templates.find(t => t._id === settings.defaultTemplates?.scripture) || null
        }

        applyTemplateToSlide(
            tempSlide,
            templateToUse,
            settings.defaultBackground.default?.background || settings.defaultBackground.bible?.background,
            settings.defaultBackground.default?.backgroundType || settings.defaultBackground.bible?.backgroundType,
            settings.defaultBackground.default?.backgroundVideoKey ?? settings.defaultBackground.bible?.backgroundVideoKey ?? undefined,
        )

        const headword = formatHeadword(entry.word)
        const totalParts = options?.totalParts ?? 1
        const partIndex = options?.partIndex ?? 0

        tempSlide.title = headword
        tempSlide.name = totalParts > 1
            ? `Define: ${headword} (${partIndex + 1}/${totalParts})`
            : `Define: ${headword}`

        if (totalParts > 1) {
            tempSlide.verseIndex = partIndex
            tempSlide.totalVerses = totalParts
            tempSlide.verseLabel = `Part ${partIndex + 1} of ${totalParts}`
        }

        tempSlide.slideStyle = {
            ...tempSlide.slideStyle,
            fontSize: Number(calculateScreenFontSize(text)),
        }
        tempSlide.data = entry
        tempSlide.contents = buildDictionaryContents(entry, text, options?.pack)

        trackEvent(AnalyticsEventType.SLIDE_CREATED, {
            slide_type: 'dictionary',
            source: 'dictionary_panel',
            pack: entry.packId,
            has_template: !!templateToUse,
        })

        return tempSlide
    }, [preSlideCreation, settings, templates, trackEvent])

    /**
     * A whole entry as slides — one per sense, further split when a sense is
     * too long to project. `senseIndex` narrows it to a single sense, which is
     * what the panel's per-sense Add/Live buttons use.
     */
    const createDictionarySlides = useCallback((
        entry: DictionaryEntry,
        options?: {
            pack?: DictionaryPack | null
            template?: TemplateItem | null
            senseIndex?: number
            maxCharsPerSlide?: number
        }
    ): Slide[] => {
        const senses = typeof options?.senseIndex === 'number'
            ? entry.senses.slice(options.senseIndex, options.senseIndex + 1)
            : entry.senses

        const chunks = senses.flatMap((sense) =>
            chunkDefinitionText(sense.text, options?.maxCharsPerSlide))

        return chunks.map((text, index) => createDictionarySlide(entry, text, {
            pack: options?.pack,
            template: options?.template,
            partIndex: index,
            totalParts: chunks.length,
        }))
    }, [createDictionarySlide])

    const createHymnSlide = useCallback((hymn: Hymn, verseIndex?: number, options?: { template?: TemplateItem | null }): Slide => {
        const tempSlide = preSlideCreation()
        tempSlide.layout = slideLayoutTypes.bible
        tempSlide.type = slideTypes.hymn

        let templateToUse: TemplateItem | null = null
        if (options?.template) {
            templateToUse = options.template
        } else if (settings.defaultTemplates?.hymn && templates) {
            templateToUse = templates.find(t => t._id === settings.defaultTemplates?.hymn) || null
        }

        applyTemplateToSlide(
            tempSlide,
            templateToUse,
            settings.defaultBackground.default?.background || settings.defaultBackground.hymn?.background,
            settings.defaultBackground.default?.backgroundType || settings.defaultBackground.hymn?.backgroundType,
            settings.defaultBackground.default?.backgroundVideoKey ?? settings.defaultBackground.hymn?.backgroundVideoKey ?? undefined,
        )
        tempSlide.songId = hymn.number
        tempSlide.hasChorus = hymn.chorus === 'false' ? false : !!hymn.chorus

        // Calculate total verses (including chorus if present)
        const totalVerses = hymn.verses?.length || 0
        const hasChorus = hymn.chorus && hymn.chorus !== 'false'
        const actualVerseIndex = verseIndex ?? 0

        // Determine verse label
        let verseLabel = `Verse ${actualVerseIndex + 1}`
        if (hasChorus && actualVerseIndex === totalVerses) {
            verseLabel = 'Chorus'
        }

        tempSlide.title = verseLabel
        tempSlide.verseIndex = actualVerseIndex
        tempSlide.totalVerses = totalVerses + (hasChorus ? 1 : 0)
        tempSlide.verseLabel = verseLabel

        // Get the content for this verse
        let currentVerse: string
        if (hasChorus && actualVerseIndex === totalVerses) {
            currentVerse = hymn.chorus
        } else {
            currentVerse = hymn.verses?.[actualVerseIndex]?.trim() || ''
        }

        const fontSize = calculateScreenFontSize(currentVerse)
        tempSlide.slideStyle = {
            ...tempSlide.slideStyle,
            fontSize: Number(fontSize),
        }
        tempSlide.data = hymn
        tempSlide.contents = generateSlideContent(tempSlide, hymn, currentVerse)
        tempSlide.name = `${hymn.title} - ${verseLabel}`

        trackEvent(AnalyticsEventType.SLIDE_CREATED, {
            slide_type: 'hymn',
            source: 'quick_action',
            has_template: !!templateToUse,
        })

        return tempSlide
    }, [preSlideCreation, settings, templates, trackEvent])

    const createHymnSlides = useCallback((hymn: Hymn, options?: { template?: TemplateItem | null }): Slide[] => {
        const slides: Slide[] = []
        const totalVerses = hymn.verses?.length || 0
        const hasChorus = hymn.chorus && hymn.chorus !== 'false'

        for (let i = 0; i < totalVerses; i++) {
            slides.push(createHymnSlide(hymn, i, options))
        }

        if (hasChorus) {
            slides.push(createHymnSlide(hymn, totalVerses, options))
        }

        return slides
    }, [createHymnSlide])

    const createSongSlide = useCallback((song: Song, verseIndex?: number, options?: { template?: TemplateItem | null }): Slide => {
        const tempSlide = preSlideCreation()
        tempSlide.layout = slideLayoutTypes.bible
        tempSlide.type = slideTypes.song

        let templateToUse: TemplateItem | null = null
        if (options?.template) {
            templateToUse = options.template
        } else if (settings.defaultTemplates?.song && templates) {
            templateToUse = templates.find(t => t._id === settings.defaultTemplates?.song) || null
        }

        applyTemplateToSlide(
            tempSlide,
            templateToUse,
            settings.defaultBackground.default?.background || settings.defaultBackground.song?.background,
            settings.defaultBackground.default?.backgroundType || settings.defaultBackground.song?.backgroundType,
            settings.defaultBackground.default?.backgroundVideoKey ?? settings.defaultBackground.song?.backgroundVideoKey ?? undefined,
        )
        tempSlide.songId = song._id || song.id

        // Calculate total verses
        const totalVerses = song.verses?.length || 0
        const actualVerseIndex = verseIndex ?? 0

        // Determine verse label
        const verseLabel = `Verse ${actualVerseIndex + 1}`

        tempSlide.title = verseLabel
        tempSlide.verseIndex = actualVerseIndex
        tempSlide.totalVerses = totalVerses
        tempSlide.verseLabel = verseLabel

        // Get the content for this verse
        const currentVerse = song.verses?.[actualVerseIndex]?.trim() || ''

        const fontSize = calculateScreenFontSize(currentVerse)
        tempSlide.slideStyle = {
            ...tempSlide.slideStyle,
            fontSize: Number(fontSize),
        }
        tempSlide.data = song
        tempSlide.contents = generateSlideContent(tempSlide, song, currentVerse)
        tempSlide.name = `${song.title} - ${verseLabel}`

        trackEvent(AnalyticsEventType.SLIDE_CREATED, {
            slide_type: 'song',
            source: 'quick_action',
            has_template: !!templateToUse,
        })

        return tempSlide
    }, [preSlideCreation, settings, templates, trackEvent])

    const createSongSlides = useCallback((song: Song, options?: { template?: TemplateItem | null }): Slide[] => {
        // `verses` is the only thing this builds slides from, but it is a
        // derived field, not a stored one: the search path fills it in via
        // `useSong.getSong`, while anything handing over a raw library record —
        // auto-detect, for one — does not. Without it every verse collapsed
        // onto a single slide carrying the entire lyric, which is not a
        // recognisable failure to an operator, just a song that inexplicably
        // stopped being multi-slide. Derive it here so it cannot depend on
        // which path reached us.
        const verses = song.verses?.length
            ? song.verses
            : sectionsForSong(song).map((section) => section.lines.join('\n'))
        const source: Song = verses.length ? { ...song, verses } : song

        const slides: Slide[] = []
        const totalVerses = source.verses?.length || 0

        if (totalVerses === 0) {
            // Genuinely nothing to split on — a song with neither verses,
            // sections, nor lyrics.
            console.warn('No verses found in song! Creating single slide with full lyrics.')
            const slide = createSongSlide(source, 0, options)
            slide.contents = [source.lyrics || '']
            slide.name = source.title || 'Song'
            slides.push(slide)
        } else {
            for (let i = 0; i < totalVerses; i++) {
                slides.push(createSongSlide(source, i, options))
            }
        }

        return slides
    }, [createSongSlide])

    const createMediaSlide = useCallback(async (
        file: ExtendedFileT & { isExternal?: boolean },
        options?: { oneOfManySlides?: boolean }
    ): Promise<Slide> => {
        const tempSlide = preSlideCreation()
        tempSlide.layout = slideLayoutTypes.empty

        const randomImage =
            'https://images.unsplash.com/photo-1515162305285-0293e4767cc2?q=80&w=1740'
        tempSlide.type = slideTypes.media
        tempSlide.slideStyle = {
            ...tempSlide.slideStyle,
            // 'fit' (contain) by default so nothing — a flier's title, a
            // speaker's face — gets cropped off; the operator can switch to
            // 'crop' (cover, no letterboxing) per-slide if they prefer that.
            backgroundFillType: backgroundFillTypes.fit,
        }

        // Handle external videos (YouTube/Vimeo) — these embed live via an
        // iframe, so there is no local background URL to resolve.
        if (file.isExternal) {
            const externalVideo: ExternalVideo = {
                url: file.url,
                type: file.type,
                thumbnail: file.thumbnail,
                name: file.name,
            }
            tempSlide.backgroundType = backgroundTypes.external
            tempSlide.background = undefined
            tempSlide.backgroundVideoKey = null
            tempSlide.data = externalVideo
            tempSlide.name = file.name || `${file.type} Video`
            tempSlide.slideStyle = {
                ...tempSlide.slideStyle,
                isMediaPlaying: true,
                isMediaMuted: false,
            }

            await saveMedia({
                id: tempSlide.id,
                content: { type: file.type },
                data: externalVideo,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            })
        } else {
            // Handle regular files
            tempSlide.backgroundType = file.type === 'audio' ? backgroundTypes.image : file.type
            tempSlide.background = file.type === 'audio' ? randomImage : file.url
            tempSlide.backgroundVideoKey = file.type?.includes(backgroundTypes.video)
                ? settings.defaultBackground.default?.backgroundVideoKey
                : null
            tempSlide.data = file
            tempSlide.name = generateSlideName(tempSlide)

            // Local video content plays with sound, once, unlike ambient
            // looping background videos — the operator can still toggle
            // loop/mute via the live transport controls.
            if (file.type === backgroundTypes.video) {
                tempSlide.slideStyle = {
                    ...tempSlide.slideStyle,
                    isMediaPlaying: true,
                    isMediaMuted: false,
                    repeatMedia: false,
                }
            }

            if (file.blob) {
                const arrayBuffer = await file.blob.arrayBuffer()
                await saveMedia({
                    id: tempSlide.id,
                    content: { size: file.blob.size, type: file.blob.type },
                    data: arrayBuffer,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                })
            }
        }

        trackEvent(AnalyticsEventType.SLIDE_CREATED, {
            slide_type: 'media',
            source: file.isExternal ? 'external_video' : 'media_picker',
            media_type: file.type,
            is_external: !!file.isExternal,
        })

        return tempSlide
    }, [preSlideCreation, settings, trackEvent])

    const createMultipleMediaSlides = useCallback(async (files: ExtendedFileT[]): Promise<Slide[]> => {
        const slides: Slide[] = []

        for (const file of files) {
            const slide = await createMediaSlide(file, { oneOfManySlides: true })
            slides.push(slide)
        }

        return slides
    }, [createMediaSlide])

    const createCountdownSlide = useCallback((countdown: Countdown): Slide => {
        const tempSlide = preSlideCreation()
        tempSlide.layout = slideLayoutTypes.countdown
        tempSlide.type = slideTypes.countdown
        tempSlide.background = settings.defaultBackground.hymn?.background
        tempSlide.backgroundVideoKey = settings.defaultBackground.hymn?.backgroundVideoKey
        tempSlide.backgroundType = settings.defaultBackground.hymn?.backgroundType
        tempSlide.data = countdown
        tempSlide.name = `${countdown.time?.replace('00:', '')}`
        tempSlide.contents = generateSlideContent(tempSlide, countdown)

        tempSlide.slideStyle = {
            ...tempSlide.slideStyle,
            fontSize: 17.5,
            alignment: 'center',
        }

        trackEvent(AnalyticsEventType.SLIDE_CREATED, {
            slide_type: 'countdown',
            source: 'quick_action',
        })

        return tempSlide
    }, [preSlideCreation, settings, trackEvent])

    const createLowerThirdSlide = useCallback((title?: string, subtitle?: string): Slide => {
        const tempSlide = preSlideCreation()
        tempSlide.layout = slideLayoutTypes.lower_third
        tempSlide.type = slideTypes.text
        tempSlide.background =
            settings.defaultBackground.default?.background ||
            settings.defaultBackground.text?.background
        tempSlide.backgroundVideoKey =
            settings.defaultBackground.default?.backgroundVideoKey ||
            settings.defaultBackground.text?.backgroundVideoKey
        tempSlide.backgroundType =
            settings.defaultBackground.default?.backgroundType ||
            settings.defaultBackground.text?.backgroundType

        const displayTitle = title || 'Speaker Name'
        tempSlide.name = displayTitle
        tempSlide.contents = [`<p>${displayTitle}</p>`]

        tempSlide.slideStyle = {
            ...tempSlide.slideStyle,
            fontSize: 3.5,
            alignment: 'left',
            lowerThirdStyle: 'standard',
            lowerThirdPosition: 'left',
            lowerThirdAccentColor: '#0d9488',
            lowerThirdSubtitle: subtitle || '',
        }

        trackEvent(AnalyticsEventType.SLIDE_CREATED, {
            slide_type: 'lower_third',
            source: 'quick_action',
        })

        return tempSlide
    }, [preSlideCreation, settings, trackEvent])

    return {
        preSlideCreation,
        createTextSlide,
        createBibleSlide,
        createDictionarySlide,
        createDictionarySlides,
        createHymnSlide,
        createHymnSlides,
        createSongSlide,
        createSongSlides,
        createMediaSlide,
        createMultipleMediaSlides,
        createCountdownSlide,
        createLowerThirdSlide,
        duplicateSlide,
        generateObjectId,
    }
}
