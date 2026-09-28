/**
 * A slide body as HTML.
 *
 * Most bodies are already HTML (the editor, scripture). Song and hymn verses
 * are plain text with a line per sung line, and rendered as HTML those
 * newlines collapse to spaces: every verse came out as one run-on sentence,
 * on the projector as much as in the queue. Plain text is escaped and its
 * line breaks kept.
 */
const LOOKS_LIKE_HTML = /<\/?[a-z][^>]*>/i

export function slideBodyHtml(content: string | undefined | null): string {
    if (!content) return ''
    if (LOOKS_LIKE_HTML.test(content)) return content
    return content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\r?\n/g, '<br>')
}
