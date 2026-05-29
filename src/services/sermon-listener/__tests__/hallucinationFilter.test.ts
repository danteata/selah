import { describe, it, expect } from 'vitest'
import {
    filterHallucinations,
    correctAccentMishearings,
} from '../hallucinationFilter'

describe('hallucinationFilter', () => {
    // -----------------------------------------------------------------------
    // filterHallucinations — full pipeline
    // -----------------------------------------------------------------------
    describe('filterHallucinations', () => {
        it('returns identity for empty string', () => {
            const result = filterHallucinations('')
            expect(result.cleanedText).toBe('')
            expect(result.hadHallucination).toBe(false)
            expect(result.confidence).toBe(1)
        })

        it('returns identity for whitespace-only string', () => {
            const result = filterHallucinations('   ')
            expect(result.cleanedText).toBe('   ')
            expect(result.hadHallucination).toBe(false)
        })

        it('returns identity for clean sermon text', () => {
            const text = 'For God so loved the world that he gave his only Son'
            const result = filterHallucinations(text)
            expect(result.hadHallucination).toBe(false)
            expect(result.confidence).toBe(1)
        })

        it('detects and removes "subscribe" filler', () => {
            const text = 'And he said please subscribe and like this video'
            const result = filterHallucinations(text)
            expect(result.hadHallucination).toBe(true)
            expect(result.fillersRemoved).toBeGreaterThanOrEqual(1)
            expect(result.cleanedText).not.toContain('subscribe')
        })

        it('detects and removes "thanks for watching" filler', () => {
            const text = 'In Jesus name we pray thanks for watching amen'
            const result = filterHallucinations(text)
            expect(result.hadHallucination).toBe(true)
            expect(result.fillersRemoved).toBeGreaterThanOrEqual(1)
            expect(result.cleanedText).not.toContain('watching')
        })

        it('detects and removes "thank you" repetition', () => {
            const text = 'thank you thank you brother'
            const result = filterHallucinations(text)
            expect(result.hadHallucination).toBe(true)
            expect(result.fillersRemoved).toBeGreaterThanOrEqual(1)
        })

        it('detects and removes profanity', () => {
            const text = 'And he went to a far country'
            // Note: the word "far" is NOT profanity, but "fuck" would be.
            // Let's test with actual profanity that Whisper might hallucinate.
            const textWithProfanity = 'He said what the hell are you doing'
            const result = filterHallucinations(textWithProfanity)
            expect(result.profanityRemoved).toBeGreaterThanOrEqual(1)
            expect(result.cleanedText).not.toContain('hell')
        })

        it('removes repetition loops (3+ repeats of 2+ word phrase)', () => {
            const text = 'praise the lord praise the lord praise the lord forever'
            const result = filterHallucinations(text)
            expect(result.hadHallucination).toBe(true)
            expect(result.repetitionsRemoved).toBeGreaterThanOrEqual(1)
            // Should keep at least one occurrence
            expect(result.cleanedText).toContain('praise')
        })

        it('does not flag non-repetitive text as hallucination', () => {
            const text = 'The Lord is my shepherd I shall not want'
            const result = filterHallucinations(text)
            expect(result.hadHallucination).toBe(false)
            expect(result.repetitionsRemoved).toBe(0)
            expect(result.fillersRemoved).toBe(0)
        })

        it('lowers confidence when hallucination is found', () => {
            const text = 'please subscribe and like'
            const result = filterHallucinations(text)
            expect(result.confidence).toBeLessThan(1)
        })

        it('reduces confidence for implausible references (>999)', () => {
            const text = 'In chapter 1234 of the Bible'
            const result = filterHallucinations(text)
            expect(result.confidence).toBeLessThanOrEqual(0.8)
        })
    })

    // -----------------------------------------------------------------------
    // correctAccentMishearings
    // -----------------------------------------------------------------------
    describe('correctAccentMishearings', () => {
        it('corrects "some 23" to "Psalm 23"', () => {
            const corrected = correctAccentMishearings('some 23')
            expect(corrected).toBe('Psalm 23')
        })

        it('corrects "sum 23" to "Psalm 23"', () => {
            const corrected = correctAccentMishearings('sum 23')
            expect(corrected).toBe('Psalm 23')
        })

        it('corrects "proves" to "Proverbs"', () => {
            const corrected = correctAccentMishearings('proves')
            expect(corrected).toBe('Proverbs')
        })

        it('corrects "efficient" to "Ephesians"', () => {
            const corrected = correctAccentMishearings('efficient')
            expect(corrected).toBe('Ephesians')
        })

        it('corrects "galations" to "Galatians"', () => {
            const corrected = correctAccentMishearings('galations')
            expect(corrected).toBe('Galatians')
        })

        it('corrects "thesalonians" to "Thessalonians"', () => {
            const corrected = correctAccentMishearings('thesalonians')
            expect(corrected).toBe('Thessalonians')
        })

        it('corrects "revelations" to "Revelation"', () => {
            const corrected = correctAccentMishearings('revelations')
            expect(corrected).toBe('Revelation')
        })

        it('corrects "physicians 3" to "Philippians 3"', () => {
            const corrected = correctAccentMishearings('physicians 3')
            expect(corrected).toBe('Philippians 3')
        })

        it('corrects "colossus 2" to "Colossians 2"', () => {
            const corrected = correctAccentMishearings('colossus 2')
            expect(corrected).toBe('Colossians 2')
        })

        it('corrects "an IV" to "NIV"', () => {
            const corrected = correctAccentMishearings('read from an IV')
            expect(corrected).toBe('read from NIV')
        })

        it('corrects "an LT" to "NLT"', () => {
            const corrected = correctAccentMishearings('use an LT')
            expect(corrected).toBe('use NLT')
        })

        it('corrects "best five" to "verse 5"', () => {
            const corrected = correctAccentMishearings('best five')
            expect(corrected).toBe('verse 5')
        })

        it('corrects "vers 10" to "verse 10"', () => {
            const corrected = correctAccentMishearings('vers 10')
            expect(corrected).toBe('verse 10')
        })

        it('corrects "Hebrew" (standalone) to "Hebrews"', () => {
            const corrected = correctAccentMishearings('the book of Hebrew')
            expect(corrected).toBe('the book of Hebrews')
        })

        it('does NOT replace "Hebrew text" (context-guarded)', () => {
            const corrected = correctAccentMishearings('Hebrew text')
            expect(corrected).toBe('Hebrew text')
        })

        it('corrects "judge 5" to "Judges 5"', () => {
            const corrected = correctAccentMishearings('judge 5')
            expect(corrected).toBe('Judges 5')
        })

        it('corrects "number 10" to "Numbers 10"', () => {
            const corrected = correctAccentMishearings('number 10')
            expect(corrected).toBe('Numbers 10')
        })

        it('corrects "look 3" to "Luke 3"', () => {
            const corrected = correctAccentMishearings('look 3')
            expect(corrected).toBe('Luke 3')
        })

        it('corrects "romance 8" to "Romans 8"', () => {
            const corrected = correctAccentMishearings('romance 8')
            expect(corrected).toBe('Romans 8')
        })

        it('corrects "root 2" to "Ruth 2"', () => {
            const corrected = correctAccentMishearings('root 2')
            expect(corrected).toBe('Ruth 2')
        })

        it('corrects "easter 4" to "Esther 4"', () => {
            const corrected = correctAccentMishearings('easter 4')
            expect(corrected).toBe('Esther 4')
        })

        it('corrects "my t5" to "Matthew 5"', () => {
            const corrected = correctAccentMishearings('my t5')
            expect(corrected).toBe('Matthew 5')
        })

        it('corrects "chop that 3" to "chapter 3"', () => {
            const corrected = correctAccentMishearings('chop that 3')
            expect(corrected).toBe('chapter 3')
        })

        it('corrects "pass 7" to "verse 7"', () => {
            const corrected = correctAccentMishearings('pass 7')
            expect(corrected).toBe('verse 7')
        })

        it('preserves non-matching text', () => {
            const text = 'The grace of our Lord Jesus Christ'
            const corrected = correctAccentMishearings(text)
            expect(corrected).toBe(text)
        })
    })
})
