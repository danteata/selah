// all-MiniLM-L6-v2 returns real verse paraphrases in the 0.70-0.85 range.
// Anything below 0.65 is surface overlap on common theological words and
// produces false positives like "finished" → John 19:30, "God has left" →
// Numbers 10:31, "monkey" → Revelation 10:7. Tune to reject noise.
const THRESHOLD_FLOOR = 0.55
const THRESHOLD_CEILING = 0.72

const BANDS: Array<{ maxWords: number; threshold: number }> = [
    { maxWords: 4, threshold: 0.60 },
    { maxWords: 8, threshold: 0.65 },
    { maxWords: 14, threshold: 0.68 },
    { maxWords: Infinity, threshold: 0.70 },
]

export function getDynamicThreshold(wordCount: number, mode?: 'sentence' | 'window'): number {
    let threshold: number | undefined
    for (const band of BANDS) {
        if (wordCount <= band.maxWords) {
            threshold = band.threshold
            break
        }
    }
    threshold = threshold ?? BANDS[BANDS.length - 1].threshold

    if (mode === 'window') {
        return Math.max(threshold, WINDOW_THRESHOLD_FLOOR)
    }

    return clampThreshold(threshold)
}

const WINDOW_THRESHOLD_FLOOR = 0.72

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

const BIBLICAL_SYNONYMS: Record<string, string[]> = {
    'house': ['court', 'courts', 'temple', 'dwelling', 'tabernacle', 'sanctuary'],
    'courts': ['court', 'house', 'temple', 'dwelling', 'tabernacle', 'sanctuary'],
    'court': ['courts', 'house', 'temple', 'dwelling', 'tabernacle', 'sanctuary'],
    'shepherd': ['pastor', 'keeper', 'guide', 'leader'],
    'lord': ['god', 'yahweh', 'jehovah', 'almighty', 'creator'],
    'god': ['lord', 'yahweh', 'jehovah', 'almighty', 'creator'],
    'righteousness': ['justice', 'uprightness', 'integrity', 'holiness'],
    'salvation': ['deliverance', 'rescue', 'redemption', '-saving'],
    'faith': ['trust', 'belief', 'confidence'],
    'grace': ['mercy', 'favor', 'kindness', 'compassion'],
    'mercy': ['grace', 'compassion', 'forgiveness', 'lovingkindness'],
    'forgive': ['pardon', 'absolve', 'excuse'],
    'sin': ['transgression', 'iniquity', 'wrongdoing', 'trespass', 'offense'],
    'righteous': ['just', 'upright', 'blameless', 'holy'],
    'wicked': ['evil', 'ungodly', 'sinful', 'wrong'],
    'blessed': ['happy', 'favored', 'fortunate'],
    'pray': ['plead', 'ask', 'beseech', 'entreat'],
    'praise': ['worship', 'glorify', 'extol', 'bless'],
    'trust': ['believe', 'rely', 'depend', 'confide'],
    'love': ['cherish', 'devotion', 'affection'],
    'hope': ['expect', 'anticipate', 'trust'],
    'peace': ['shalom', 'calm', 'rest', 'tranquility'],
    'eternal': ['everlasting', 'forever', 'perpetual'],
    'heaven': ['sky', 'heavens', 'paradise'],
    'earth': ['world', 'land', 'ground'],
    'throne': ['seat', 'rule', 'reign', 'authority'],
    'king': ['ruler', 'sovereign', 'monarch'],
    'kingdom': ['reign', 'dominion', 'realm', 'rule'],
    'spirit': ['ghost', 'breath', 'wind', 'soul'],
    'flesh': ['body', 'mortal', 'human'],
    'cross': ['crucify', 'crucifixion', 'calvary'],
    'resurrection': ['rising', 'raised', 'life'],
    'baptize': ['baptism', 'wash', 'cleanse', 'immerse'],
    'covenant': ['promise', 'agreement', 'pact', 'testament'],
    'sacrifice': ['offering', 'oblation', 'gift'],
    'redeem': ['ransom', 'buy', 'rescue', 'deliver'],
    'anoint': ['consecrate', 'ordain', 'set'],
    'glory': ['majesty', 'splendor', 'honor', 'radiance'],
    'light': [' illumination', 'brightness', 'radiance', 'day'],
    'darkness': ['night', 'shadow', 'gloom', 'obscurity'],
    'bread': ['food', 'manna', 'sustenance', 'provision'],
    'water': ['river', 'stream', 'fountain', 'spring'],
    'fire': ['flame', 'burning', 'blaze'],
    'mountain': ['hill', 'mount', 'height', 'peak'],
    'wilderness': ['desert', 'waste', 'barren'],
    'sheep': ['flock', 'lamb', 'herd'],
    'vine': ['vineyard', 'grape', 'branch'],
    'seed': ['offspring', 'descendant', 'planting'],
    'harvest': ['reap', 'crop', 'gather', 'fruit'],
    'sword': ['weapon', 'blade'],
    'shield': ['buckler', 'protection', 'defense'],
    'tower': ['fortress', 'stronghold', 'citadel', 'refuge'],
}

const ARCHAIC_STEM_MAP: Record<string, string> = {
    'builded': 'built',
    'thou': 'you',
    'thine': 'yours',
    'thy': 'your',
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
    return ARCHAIC_STEM_MAP[lower] || lower
}

export function removeStopWords(text: string): string {
    return text
        .split(/\s+/)
        .filter(w => !STOP_WORDS.has(w.toLowerCase()))
        .join(' ')
}

const DIGIT_WORDS: Record<string, string> = {
    '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
    '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
    '10': 'ten', '11': 'eleven', '12': 'twelve', '13': 'thirteen', '14': 'fourteen',
    '15': 'fifteen', '16': 'sixteen', '17': 'seventeen', '18': 'eighteen', '19': 'nineteen',
    '20': 'twenty', '30': 'thirty', '40': 'forty', '50': 'fifty',
    '60': 'sixty', '70': 'seventy', '80': 'eighty', '90': 'ninety',
    '100': 'one hundred', '1000': 'one thousand',
}

function replaceDigitsWithWords(text: string): string {
    return text.replace(/\b(\d{1,4})\b/g, (match) => {
        const num = parseInt(match, 10)
        if (num <= 20) return DIGIT_WORDS[match] || match
        if (num < 100 && num % 10 === 0) return DIGIT_WORDS[match] || match
        if (num === 100 || num === 1000) return DIGIT_WORDS[match] || match
        return match
    })
}

export function normalizeQuery(text: string): string {
    const cleaned = text
        .toLowerCase()
        .replace(/[.,;:!?()[\]{}'"]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    const withWords = replaceDigitsWithWords(cleaned)
    return removeStopWords(withWords)
}

export function getContentWords(text: string): string[] {
    const normalized = normalizeQuery(text)
    if (!normalized) return []
    return normalized.split(/\s+/).map(stemWord).filter(Boolean)
}

function getSynonyms(word: string): string[] {
    const lower = word.toLowerCase()
    const direct = BIBLICAL_SYNONYMS[lower]
    if (direct) return direct
    const stemmed = stemWord(lower)
    if (BIBLICAL_SYNONYMS[stemmed]) return BIBLICAL_SYNONYMS[stemmed]
    return []
}

function isSynonymMatch(queryWord: string, verseWord: string): boolean {
    const qLower = queryWord.toLowerCase()
    const vLower = verseWord.toLowerCase()
    if (qLower === vLower) return true
    const qSyns = getSynonyms(qLower)
    if (qSyns.some(s => s === vLower)) return true
    const vSyns = getSynonyms(vLower)
    if (vSyns.some(s => s === qLower)) return true
    return false
}

const THEOLOGICAL_COMMON = new Set([
    'god', 'lord', 'jesus', 'christ', 'holy', 'spirit', 'ghost',
    'heaven', 'heavenly', 'father', 'son', 'church', 'faith', 'pray',
    'prayer', 'love', 'grace', 'mercy', 'sin', 'sinner', 'believe',
    'believer', 'believers', 'saved', 'salvation', 'glory', 'praise',
    'worship', 'bless', 'blessed', 'blessing', 'eternal', 'forever',
    'angel', 'angels', 'prophet', 'prophets', 'apostle', 'apostles',
    'disciple', 'disciples', 'righteous', 'righteousness', 'wicked',
    'judge', 'judgment', 'king', 'kingdom', 'priest', 'priestly',
    'sacrifice', 'offering', 'commandment', 'commandments', 'law',
    'covenant', 'promise', 'preach', 'preaching', 'teach', 'teaching',
    'teacher', 'ministry', 'minister', 'gift', 'gifts', 'baptize',
    'baptism', 'cross', 'resurrection', 'born', 'gather', 'gathered',
])

function isTheologicalCommon(word: string): boolean {
    return THEOLOGICAL_COMMON.has(word.toLowerCase())
}

export function validateSemanticMatch(
    query: string,
    verseText: string,
    queryWordCount: number,
): boolean {
    const queryContentWords = getContentWords(query)
    const verseContentWords = getContentWords(verseText)

    if (queryContentWords.length < 2) return false

    const verseSet = new Set(verseContentWords)
    let overlapCount = 0
    let distinctiveOverlap = 0

    for (const w of queryContentWords) {
        const exactMatch = verseSet.has(w)
        const synonymMatch = !exactMatch && verseContentWords.some(v => isSynonymMatch(w, v))
        if (exactMatch || synonymMatch) {
            overlapCount++
            // Distinctive = the matched word is itself non-theological.
            // Synonym matches on theological-common words (god/lord/spirit/holy/...)
            // do NOT count as distinctive — their synonym map is so broad
            // that almost any verse will match. e.g. "God" ↔ "Lord" should not
            // be enough to validate Numbers 10:31 against an unrelated utterance.
            if (!isTheologicalCommon(w)) {
                distinctiveOverlap++
            }
        }
    }

    if (overlapCount < 2) return false

    if (distinctiveOverlap >= 2) return true

    if (distinctiveOverlap === 1 && overlapCount >= 2 && queryWordCount <= 8) return true

    if (distinctiveOverlap === 0 && overlapCount >= 3 && queryWordCount <= 5) return true

    if (distinctiveOverlap === 0 && queryWordCount >= 6) return false

    return false
}

// A candidate that only barely out-scores a runner-up from a *different*
// verse means the embedding isn't confidently distinguishing between two
// distinct meanings — the top hit could easily be the wrong one. In that
// case we'd rather show nothing than guess. Runner-ups from the same
// book+chapter as the top match don't count: neighboring verses are
// expected to score similarly, and chapter-level dedup downstream already
// picks the single strongest verse per chapter.
const AMBIGUITY_MARGIN = 0.05

export interface ScoredVerseCandidate {
    score: number
    book: string
    chapter: number
}

export function isAmbiguousMatch(best: ScoredVerseCandidate, candidates: ScoredVerseCandidate[]): boolean {
    const runnerUp = candidates.find(c => c !== best && (c.book !== best.book || c.chapter !== best.chapter))
    if (!runnerUp) return false
    return best.score - runnerUp.score < AMBIGUITY_MARGIN
}