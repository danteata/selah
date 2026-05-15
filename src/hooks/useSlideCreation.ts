import { useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import type {
    Slide,
    Scripture,
    Hymn,
    Song,
    Countdown,
    ExtendedFileT,
    SlideStyle
} from '../types'
import {
    slideTypes,
    slideLayoutTypes,
    backgroundTypes,
    backgroundFillTypes
} from '../types'
import { saveMedia } from './useIndexedDB'
import type { TemplateItem } from './useTemplates'
import { useTemplates } from './useTemplates'

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

    if (templateSlide) {
        tempSlide.background = templateSlide.background || defaultBg
        tempSlide.backgroundType = templateSlide.backgroundType || defaultBgType
        tempSlide.backgroundStorageId = templateSlide.backgroundStorageId || null
        tempSlide.backgroundVideoKey = templateSlide.backgroundVideoKey || null
        tempSlide.localFilePath = templateSlide.localFilePath || undefined
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
    currentVerse?: string
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
                const versesText = scripture.content
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
                font: settings.defaultFont,
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

        return tempSlide
    }, [preSlideCreation, settings, templates])

    const duplicateSlide = useCallback((slideToDuplicate?: Slide): Slide | null => {
        if (!slideToDuplicate) return null

        const tempSlide = { ...slideToDuplicate }
        delete (tempSlide as Record<string, unknown>)._id
        tempSlide.id = generateObjectId()

        return tempSlide
    }, [])

    const createBibleSlide = useCallback((
        scripture: Scripture,
        options?: { fromWholeBibleSearch?: boolean, template?: TemplateItem | null }
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
            settings.defaultBackground.default?.backgroundVideoKey || settings.defaultBackground.bible?.backgroundVideoKey,
        )

        tempSlide.title = scripture?.label
        tempSlide.name = generateSlideName(tempSlide)

        const contentString = typeof scripture?.content === 'string'
            ? scripture?.content
            : Array.isArray(scripture?.content)
                ? scripture?.content.map((v: { scripture: string }) => v.scripture).join(' ')
                : ''
        const fontSize = calculateScreenFontSize(contentString)

        tempSlide.slideStyle = {
            ...tempSlide.slideStyle,
            fontSize: Number(fontSize),
            font: settings.defaultFont,
            bibleVersion: scripture.version,
        }
        tempSlide.data = scripture
        tempSlide.contents = generateSlideContent(tempSlide, scripture)

        return tempSlide
    }, [preSlideCreation, settings, templates])

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
            settings.defaultBackground.default?.backgroundVideoKey || settings.defaultBackground.hymn?.backgroundVideoKey,
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
            font: settings.defaultFont,
        }
        tempSlide.data = hymn
        tempSlide.contents = generateSlideContent(tempSlide, hymn, currentVerse)
        tempSlide.name = `${hymn.title} - ${verseLabel}`

        return tempSlide
    }, [preSlideCreation, settings])

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
            settings.defaultBackground.default?.background || settings.defaultBackground.hymn?.background,
            settings.defaultBackground.default?.backgroundType || settings.defaultBackground.hymn?.backgroundType,
            settings.defaultBackground.default?.backgroundVideoKey || settings.defaultBackground.hymn?.backgroundVideoKey,
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
            font: settings.defaultFont,
        }
        tempSlide.data = song
        tempSlide.contents = generateSlideContent(tempSlide, song, currentVerse)
        tempSlide.name = `${song.title} - ${verseLabel}`

        return tempSlide
    }, [preSlideCreation, settings])

    const createSongSlides = useCallback((song: Song, options?: { template?: TemplateItem | null }): Slide[] => {
        console.log('createSongSlides called with song:', song)

        const slides: Slide[] = []
        const totalVerses = song.verses?.length || 0

        if (totalVerses === 0) {
            console.warn('No verses found in song! Creating single slide with full lyrics.')
            const slide = createSongSlide(song, 0, options)
            slide.contents = [song.lyrics || '']
            slide.name = song.title || 'Song'
            slides.push(slide)
        } else {
            for (let i = 0; i < totalVerses; i++) {
                slides.push(createSongSlide(song, i, options))
            }
        }

        console.log('Created slides:', slides.length)
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
            backgroundFillType: backgroundFillTypes.crop,
        }

        // Handle external videos (YouTube/Vimeo)
        if (file.isExternal) {
            const externalVideo = {
                url: file.url,
                type: file.type,
                thumbnail: file.thumbnail,
                name: file.name,
            }
            tempSlide.backgroundType = backgroundTypes.video
            tempSlide.background = randomImage
            tempSlide.backgroundVideoKey = null
            tempSlide.data = externalVideo as ExtendedFileT
            tempSlide.name = file.name || `${file.type} Video`

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

        return tempSlide
    }, [preSlideCreation, settings])

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
            font: settings.defaultFont,
        }

        return tempSlide
    }, [preSlideCreation, settings])

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
            font: settings.defaultFont,
            lowerThirdStyle: 'standard',
            lowerThirdPosition: 'left',
            lowerThirdAccentColor: '#0d9488',
            lowerThirdSubtitle: subtitle || '',
        }

        return tempSlide
    }, [preSlideCreation, settings])

    return {
        preSlideCreation,
        createTextSlide,
        createBibleSlide,
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
