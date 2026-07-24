/**
 * Versioned retrieval evaluation fixture.
 *
 * A small representative KJV corpus plus labeled queries across the categories
 * that matter. This locks in the DETERMINISTIC parts of the pipeline
 * (reference, exact/partial phrase, keyword, fusion, guard, no-match) and
 * provides the metric machinery. It does NOT measure real semantic quality —
 * that needs the embedding model and runs as a separate opt-in script (see
 * eval.test.ts header). The dense side here is a deterministic token-overlap
 * stub standing in for embeddings.
 */

import type { BibleVerse } from '../../../../types'

// book = number-string, matching the bundled /bibles/{version}.json shape.
export const FIXTURE_CORPUS: BibleVerse[] = [
    { book: '40', chapter: '16', verse: '18', scripture: 'And I say also unto thee, That thou art Peter, and upon this rock I will build my church; and the gates of hell shall not prevail against it.' },
    { book: '40', chapter: '16', verse: '19', scripture: 'And I will give unto thee the keys of the kingdom of heaven.' },
    { book: '66', chapter: '21', verse: '25', scripture: 'And the gates of it shall not be shut at all by day: for there shall be no night there.' },
    { book: '19', chapter: '118', verse: '20', scripture: 'This gate of the LORD, into which the righteous shall enter.' },
    { book: '43', chapter: '3', verse: '16', scripture: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.' },
    { book: '19', chapter: '23', verse: '1', scripture: 'The LORD is my shepherd; I shall not want.' },
    { book: '19', chapter: '23', verse: '4', scripture: 'Yea, though I walk through the valley of the shadow of death, I will fear no evil: for thou art with me.' },
    { book: '45', chapter: '8', verse: '28', scripture: 'And we know that all things work together for good to them that love God.' },
    { book: '50', chapter: '4', verse: '13', scripture: 'I can do all things through Christ which strengtheneth me.' },
    { book: '20', chapter: '3', verse: '5', scripture: 'Trust in the LORD with all thine heart; and lean not unto thine own understanding.' },
    { book: '1', chapter: '1', verse: '1', scripture: 'In the beginning God created the heaven and the earth.' },
    { book: '43', chapter: '11', verse: '35', scripture: 'Jesus wept.' },
    { book: '49', chapter: '2', verse: '8', scripture: 'For by grace are ye saved through faith; and that not of yourselves: it is the gift of God.' },
    { book: '66', chapter: '3', verse: '20', scripture: 'Behold, I stand at the door, and knock: if any man hear my voice, and open the door, I will come in to him.' },
    { book: '40', chapter: '11', verse: '28', scripture: 'Come unto me, all ye that labour and are heavy laden, and I will give you rest.' },
    { book: '23', chapter: '40', verse: '31', scripture: 'But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles.' },
]

export type EvalCategory =
    | 'reference' | 'exact_quote' | 'partial_quote' | 'keyword'
    | 'paraphrase' | 'short_query' | 'no_match'

export interface EvaluationCase {
    query: string
    expectedVerseIds: string[]
    expectedTopRank?: number
    category: EvalCategory
}

export const EVAL_CASES: EvaluationCase[] = [
    // Direct reference lookups.
    { query: 'Matthew 16:18', expectedVerseIds: ['Matthew 16:18'], expectedTopRank: 1, category: 'reference' },
    { query: 'Matt 16:18', expectedVerseIds: ['Matthew 16:18'], expectedTopRank: 1, category: 'reference' },
    { query: 'John 3:16', expectedVerseIds: ['John 3:16'], expectedTopRank: 1, category: 'reference' },

    // Exact quotations — the reported regression + friends.
    { query: 'the gates of hell shall not', expectedVerseIds: ['Matthew 16:18'], expectedTopRank: 1, category: 'exact_quote' },
    { query: 'on this rock I will build my church', expectedVerseIds: ['Matthew 16:18'], expectedTopRank: 1, category: 'exact_quote' },
    { query: 'for God so loved the world', expectedVerseIds: ['John 3:16'], expectedTopRank: 1, category: 'exact_quote' },
    { query: 'the LORD is my shepherd', expectedVerseIds: ['Psalms 23:1'], expectedTopRank: 1, category: 'exact_quote' },

    // Partial / truncated / reordered quotes.
    { query: 'gates of hell shall not prevail', expectedVerseIds: ['Matthew 16:18'], category: 'partial_quote' },
    { query: 'shadow of death fear no evil', expectedVerseIds: ['Psalms 23:4'], category: 'partial_quote' },
    { query: 'all things through Christ', expectedVerseIds: ['Philippians 4:13'], category: 'partial_quote' },

    // Keyword sets.
    { query: 'gates shut day night', expectedVerseIds: ['Revelation 21:25'], category: 'keyword' },
    { query: 'gate lord righteous enter', expectedVerseIds: ['Psalms 118:20'], category: 'keyword' },
    { query: 'grace saved faith gift', expectedVerseIds: ['Ephesians 2:8'], category: 'keyword' },

    // No meaningful match.
    { query: 'quantum spaceship dinosaur', expectedVerseIds: [], category: 'no_match' },
]
