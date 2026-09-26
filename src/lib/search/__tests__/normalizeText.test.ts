import { describe, it, expect } from 'vitest'
import { normalizeText } from '../normalizeText'

describe('normalizeText', () => {
    it('folds accents on Latin letters, so unaccented typing still matches', () => {
        expect(normalizeText('Señor, Jésus')).toBe('senor jesus')
        expect(normalizeText('Ｆｕｌｌ　Ｗｉｄｔｈ')).toBe('full width')
    })

    it('leaves marks that are part of non-Latin letters alone', () => {
        // Devanagari vowel signs are combining marks; stripping them would
        // turn the word into something else.
        expect(normalizeText('नमस्ते')).toBe('नमस्ते')
    })

    it("keeps letters that are distinct letters, not accented ones", () => {
        // ɛ and ɔ (Twi, Ga, Ewe) are base letters, not e/o plus a mark.
        expect(normalizeText('Ɛyɛ Onyankopɔn')).toBe('ɛyɛ onyankopɔn')
    })
})
