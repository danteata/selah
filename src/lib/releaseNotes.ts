/**
 * Release notes, read from the Markdown they're written in (RELEASE_NOTES.md,
 * delivered through the update manifest) into plain data for the update dialog
 * to render. Only the subset release notes use: headings, bullet lists,
 * paragraphs, bold, inline code and links. Nothing here produces HTML.
 */

export type NotesBlock =
    | { kind: 'heading'; text: string }
    | { kind: 'paragraph'; text: string }
    | { kind: 'list'; items: string[] }

/** Split Markdown release notes into headings, paragraphs and bullet lists. */
export function parseReleaseNotes(markdown: string): NotesBlock[] {
    const blocks: NotesBlock[] = []
    let paragraph: string[] = []
    let list: string[] | null = null

    const flushParagraph = () => {
        if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
        paragraph = []
    }
    const flushList = () => {
        if (list?.length) blocks.push({ kind: 'list', items: list })
        list = null
    }

    for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
        const line = raw.trim()
        const heading = /^#{1,6}\s+(.*)$/.exec(line)
        const bullet = /^[-*+]\s+(.*)$/.exec(line)
        if (!line) {
            flushParagraph()
            flushList()
        } else if (heading) {
            flushParagraph()
            flushList()
            blocks.push({ kind: 'heading', text: heading[1].trim() })
        } else if (bullet) {
            flushParagraph()
            list = list ?? []
            list.push(bullet[1])
        } else if (list && /^\s/.test(raw)) {
            // An indented line continues the bullet above it.
            list[list.length - 1] += ` ${line}`
        } else {
            flushList()
            paragraph.push(line)
        }
    }
    flushParagraph()
    flushList()
    return blocks
}

/**
 * The blocks worth showing under a dialog that already names the version: a
 * leading "Selah 0.1.38" heading only repeats the title.
 */
export function notesForDialog(markdown: string, version: string): NotesBlock[] {
    const blocks = parseReleaseNotes(markdown)
    const first = blocks[0]
    if (first?.kind === 'heading' && first.text.replace(/^selah\s+v?/i, '') === version.replace(/^v/, '')) {
        return blocks.slice(1)
    }
    return blocks
}

/** A run of text within a line, plain or bold. Inline code and links read as plain words. */
export type NotesInline = { text: string; bold: boolean; code: boolean }

/** Bold, inline code and links within a line, as runs. */
export function parseInline(text: string): NotesInline[] {
    const out: NotesInline[] = []
    const pattern = /\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g
    let last = 0
    for (const match of text.matchAll(pattern)) {
        if (match.index > last) out.push({ text: text.slice(last, match.index), bold: false, code: false })
        const [, bold, boldAlt, code, linkText] = match
        if (bold || boldAlt) out.push({ text: bold ?? boldAlt, bold: true, code: false })
        else if (code) out.push({ text: code, bold: false, code: true })
        // Links go out as their text: the dialog isn't the place to leave the app.
        else out.push({ text: linkText, bold: false, code: false })
        last = match.index + match[0].length
    }
    if (last < text.length) out.push({ text: text.slice(last), bold: false, code: false })
    return out
}
