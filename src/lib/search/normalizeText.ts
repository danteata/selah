/**
 * The single normalization contract shared by exact-phrase matching, BM25
 * indexing/retrieval, and tests. If indexing and querying ever normalize
 * differently, lexical search silently breaks — so there is exactly one
 * implementation here.
 *
 * Deliberately NON-aggressive: we lowercase, fold Unicode and curly quotes,
 * turn punctuation into spaces, and collapse whitespace — but we do NOT stem
 * or drop stop words. Biblical quotations hinge on words a normal search
 * engine would discard ("shall not prevail", "no", "nor"); BM25's IDF already
 * down-weights common words, so removing them would only hurt exact matching.
 */

import type { NormalizedQuery } from './types'

/** Fold curly quotes/apostrophes and common typographic variants to ASCII. */
function foldQuotes(s: string): string {
    return s
        .replace(/[‘’‚‛′´`]/g, "'")
        .replace(/[“”„″]/g, '"')
        .replace(/[–—−]/g, '-')
}

/**
 * Drop accents from Latin letters, so "senor" finds "Señor" and "Jesus" finds
 * "Jésus" — what anyone typing a song title on a laptop keyboard expects.
 * Only marks on Latin letters: in scripts such as Devanagari the combining
 * marks are the vowels themselves, and removing them would wreck the word.
 */
function foldLatinDiacritics(s: string): string {
    return s
        .normalize('NFD')
        .replace(/(\p{Script=Latin})\p{Mn}+/gu, '$1')
        .normalize('NFC')
}

/**
 * Lowercase, Unicode-fold, strip punctuation to spaces, collapse whitespace.
 * Word order and every meaningful word are preserved.
 */
export function normalizeText(input: string): string {
    if (!input) return ''
    let s = input.normalize('NFKC')
    s = foldLatinDiacritics(s)
    s = foldQuotes(s)
    s = s.toLowerCase()
    // Anything that isn't a letter, mark or digit becomes a space. Marks
    // (`\p{M}`) must survive: in many scripts they are the vowels, and treating
    // them as punctuation split "नमस्ते" into "नमस त". Latin accents are
    // already folded away above. The `u` flag makes the property escapes valid.
    s = s.replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    return s.replace(/\s+/g, ' ').trim()
}

/** Tokenize normalized text. Stop words are intentionally kept (see header). */
export function tokenize(input: string): string[] {
    const norm = normalizeText(input)
    return norm ? norm.split(' ') : []
}

export function normalizeQuery(raw: string): NormalizedQuery {
    const trimmed = raw.trim()
    const phrase = normalizeText(trimmed)
    return {
        raw: trimmed,
        phrase,
        tokens: phrase ? phrase.split(' ') : [],
    }
}
