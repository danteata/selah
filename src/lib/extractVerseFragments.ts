export type FragmentType = 'full' | 'clause' | 'window'

export interface VerseFragment {
    text: string
    type: FragmentType
    fragmentIndex: number
}

const MIN_FRAGMENT_WORDS = 4
const MAX_FRAGMENT_WORDS = 14
const WINDOW_SIZE = 6
const WINDOW_STRIDE = 3
const MAX_WINDOW_WORDS = 20
const MAX_FRAGMENTS_PER_VERSE = 6

function splitClauses(text: string): string[] {
    const parts = text.split(/[,;:().!?]/)
    return parts
        .map(p => p.trim())
        .filter(p => {
            const wordCount = p.split(/\s+/).filter(Boolean).length
            return wordCount >= MIN_FRAGMENT_WORDS && wordCount <= MAX_FRAGMENT_WORDS
        })
}

function generateWindows(words: string[]): string[] {
    if (words.length < MIN_FRAGMENT_WORDS) return []

    const sourceWords = words.slice(0, MAX_WINDOW_WORDS)
    const windows: string[] = []

    if (sourceWords.length <= WINDOW_SIZE) {
        return [sourceWords.join(' ')]
    }

    for (let i = 0; i <= sourceWords.length - WINDOW_SIZE; i += WINDOW_STRIDE) {
        const window = sourceWords.slice(i, i + WINDOW_SIZE).join(' ')
        windows.push(window)
    }

    const lastWindow = sourceWords.slice(-WINDOW_SIZE).join(' ')
    if (windows.length > 0 && windows[windows.length - 1] !== lastWindow) {
        windows.push(lastWindow)
    }

    return windows
}

function fragmentSimilarity(a: string, b: string): number {
    const aWords = new Set(a.toLowerCase().split(/\s+/))
    const bWords = new Set(b.toLowerCase().split(/\s+/))
    const intersection = [...aWords].filter(w => bWords.has(w)).length
    return (2 * intersection) / (aWords.size + bWords.size)
}

function deduplicateFragments(fragments: VerseFragment[]): VerseFragment[] {
    const kept: VerseFragment[] = []
    const discarded = new Set<number>()

    for (let i = 0; i < fragments.length; i++) {
        if (discarded.has(i)) continue
        if (fragments[i].type === 'full') {
            kept.push(fragments[i])
            continue
        }

        let isDuplicate = false
        for (let j = 0; j < kept.length; j++) {
            if (kept[j].type === 'full') continue
            if (fragmentSimilarity(fragments[i].text, kept[j].text) >= 0.7) {
                isDuplicate = true
                break
            }
        }

        if (!isDuplicate) {
            kept.push(fragments[i])
        }
    }

    return kept
}

export function extractVerseFragments(verseText: string): VerseFragment[] {
    if (!verseText || !verseText.trim()) return []

    const fragments: VerseFragment[] = []
    let fragmentIndex = 0

    fragments.push({
        text: verseText.trim(),
        type: 'full',
        fragmentIndex: fragmentIndex++,
    })

    const clauseParts = splitClauses(verseText)
    for (const clause of clauseParts) {
        fragments.push({
            text: clause,
            type: 'clause',
            fragmentIndex: fragmentIndex++,
        })
    }

    const words = verseText.split(/\s+/).filter(Boolean)
    const windowParts = generateWindows(words)
    for (const window of windowParts) {
        const wordCount = window.split(/\s+/).filter(Boolean).length
        if (wordCount >= MIN_FRAGMENT_WORDS) {
            fragments.push({
                text: window,
                type: 'window',
                fragmentIndex: fragmentIndex++,
            })
        }
    }

    const deduped = deduplicateFragments(fragments)

    if (deduped.length > MAX_FRAGMENTS_PER_VERSE) {
        const fullFragments = deduped.filter(f => f.type === 'full')
        const otherFragments = deduped
            .filter(f => f.type !== 'full')
            .slice(0, MAX_FRAGMENTS_PER_VERSE - 1)
        return [...fullFragments, ...otherFragments]
    }

    return deduped
}