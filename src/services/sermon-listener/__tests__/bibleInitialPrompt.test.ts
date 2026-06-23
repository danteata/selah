import { describe, it, expect } from 'vitest'
import { buildBibleInitialPrompt } from '../bibleInitialPrompt'
import { SERMON_PROPER_NOUNS } from '../customWords'

describe('buildBibleInitialPrompt (item #6)', () => {
    it('includes the sermon framing and canonical books', () => {
        const prompt = buildBibleInitialPrompt()
        expect(prompt).toContain('Bible sermon.')
        expect(prompt).toContain('Genesis')
        expect(prompt).toContain('Revelation')
        expect(prompt).toContain('Chapter verse.')
    })

    it('biases toward hard proper nouns', () => {
        const prompt = buildBibleInitialPrompt()
        for (const name of SERMON_PROPER_NOUNS) {
            expect(prompt).toContain(name)
        }
    })

    it('appends session-specific extra terms', () => {
        const prompt = buildBibleInitialPrompt(['Grace Chapel', 'Pastor Adeyemi'])
        expect(prompt).toContain('Grace Chapel Pastor Adeyemi.')
    })

    it('ignores empty/blank extra terms', () => {
        const base = buildBibleInitialPrompt()
        expect(buildBibleInitialPrompt(['', '   '])).toBe(base)
    })

    it('stays within a reasonable token budget', () => {
        // Whisper truncates ~224 tokens; a rough word-count proxy keeps us safe.
        const wordCount = buildBibleInitialPrompt().split(/\s+/).length
        expect(wordCount).toBeLessThan(150)
    })
})
