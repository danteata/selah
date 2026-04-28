const THRESHOLD_FLOOR = 0.35
const THRESHOLD_CEILING = 0.60

const BANDS: Array<{ maxWords: number; threshold: number }> = [
    { maxWords: 4, threshold: 0.38 },
    { maxWords: 8, threshold: 0.44 },
    { maxWords: 14, threshold: 0.49 },
    { maxWords: Infinity, threshold: 0.52 },
]

export function getDynamicThreshold(wordCount: number): number {
    for (const band of BANDS) {
        if (wordCount <= band.maxWords) {
            return clampThreshold(band.threshold)
        }
    }
    return clampThreshold(BANDS[BANDS.length - 1].threshold)
}

function clampThreshold(t: number): number {
    return Math.max(THRESHOLD_FLOOR, Math.min(THRESHOLD_CEILING, t))
}

const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'shall', 'should', 'may', 'might', 'can', 'could', 'must', 'it', 'its',
    'he', 'she', 'we', 'they', 'i', 'you', 'me', 'him', 'her', 'us', 'them',
    'my', 'your', 'his', 'our', 'their', 'this', 'that', 'these', 'those',
    'not', 'no', 'nor', 'so', 'if', 'as', 'than', 'too', 'very', 'just',
    'also', 'then', 'now', 'here', 'there', 'when', 'where', 'how', 'what',
    'which', 'who', 'whom', 'whose', 'all', 'each', 'every', 'both',
    'any', 'some', 'such', 'only', 'own', 'same', 'other', 'another',
    'about', 'up', 'out', 'into', 'over', 'after', 'before', 'between',
    'through', 'during', 'until', 'while', 'because', 'although', 'though',
    'hath', 'doth', 'shalt', ' art', 'thou', 'thee', 'thy', 'thine',
    'hast', 'doest', 'wilt', 'canst', 'couldst', 'wouldst', 'shouldst',
    'ye', 'unto', 'upon', 'among', 'neath', 'saith', 'sayeth',
])

const ARCHAIc_STEM_MAP: Record<string, string> = {
    'builded': 'built',
    'build': 'built',
    'hath': 'has',
    'has': 'has',
    'doth': 'does',
    'does': 'does',
    'saith': 'says',
    'sayeth': 'says',
    'says': 'says',
    'say': 'says',
    'shalt': 'shall',
    'wilt': 'will',
    'art': 'is',
    'hast': 'has',
    'doest': 'does',
    'giveth': 'gives',
    'taketh': 'takes',
    'cometh': 'comes',
    'goeth': 'goes',
    'knoweth': 'knows',
    'seeth': 'sees',
    'heareth': 'hears',
    'speaketh': 'speaks',
    'raiseth': 'raises',
    'maketh': 'makes',
    'keepeth': 'keeps',
    'leadeth': 'leads',
    'walketh': 'walks',
    'sitteth': 'sits',
    'standeth': 'stands',
    'falleth': 'falls',
    'riseth': 'rises',
    'dwelleth': 'dwells',
    'abideth': 'abides',
    'passeth': 'passes',
    'turneth': 'turns',
    'bringeth': 'brings',
    'sendeth': 'sends',
    'layeth': 'lays',
    'putteth': 'puts',
    'setteth': 'sets',
    'casteth': 'casts',
    'bindeth': 'binds',
    'looseth': 'looses',
    'hideth': 'hides',
    'preserveth': 'preserves',
    'forgiveth': 'forgives',
    'healeth': 'heals',
    'delivereth': 'delivers',
    'redeemeth': 'redeems',
    'judgeth': 'judges',
    'ruleth': 'rules',
    'scattereth': 'scatters',
    'gathereth': 'gathers',
}

function stemWord(word: string): string {
    const lower = word.toLowerCase()
    return ARCHAIc_STEM_MAP[lower] || lower
}

export function removeStopWords(text: string): string {
    return text
        .split(/\s+/)
        .filter(w => !STOP_WORDS.has(w.toLowerCase()))
        .join(' ')
}

export function normalizeQuery(text: string): string {
    const cleaned = text
        .toLowerCase()
        .replace(/[.,;:!?()[\]{}'"]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    return removeStopWords(cleaned)
}

export function getContentWords(text: string): string[] {
    const normalized = normalizeQuery(text)
    if (!normalized) return []
    return normalized.split(/\s+/).map(stemWord).filter(Boolean)
}

export function validateSemanticMatch(
    query: string,
    verseText: string,
    queryWordCount: number,
): boolean {
    const queryContentWords = getContentWords(query)
    const verseContentWords = getContentWords(verseText)

    if (queryContentWords.length === 0) return false

    const verseSet = new Set(verseContentWords)
    const overlapCount = queryContentWords.filter(w => verseSet.has(w)).length

    if (queryWordCount <= 5) {
        return overlapCount >= 1
    }

    return overlapCount >= 2
}