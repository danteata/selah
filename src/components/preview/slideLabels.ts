import type { Slide, Song } from '../../types'

/** A slide's text with the markup taken out, on one line. */
export function plainText(html: string | undefined): string {
    return (html ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** The words on a slide, as you'd read them off the screen. */
export function slideText(slide: Slide): string {
    return plainText(slide.contents[0])
}

/** The song a verse slide belongs to, if it's one. */
export function songTitleOf(slide: Slide): string | null {
    if (!slide.songId) return null
    return (slide.data as Song | undefined)?.title || slide.name?.split(' - ')[0] || null
}

/** Which part of its song a slide is: "Chorus", "Verse 2". */
export function songSectionOf(slide: Slide): string | null {
    return slide.songId ? slide.verseLabel || null : null
}

/** What a slide is: its song, its reference, or its name. */
export function slideTitle(slide: Slide): string {
    return songTitleOf(slide) || slide.name || slideText(slide) || 'Untitled'
}
