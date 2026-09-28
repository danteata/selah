import { describe, it, expect } from 'vitest'
import { slideBodyHtml } from '../slideHtml'

describe('slideBodyHtml', () => {
    it("keeps a verse's line breaks", () => {
        expect(slideBodyHtml('Amazing grace\nhow sweet the sound')).toBe('Amazing grace<br>how sweet the sound')
    })

    it('leaves HTML alone', () => {
        expect(slideBodyHtml('<p>For God so loved</p>')).toBe('<p>For God so loved</p>')
    })

    it('escapes plain text that only looks like markup', () => {
        expect(slideBodyHtml('Fish & chips < 5')).toBe('Fish &amp; chips &lt; 5')
    })

    it('treats nothing as empty', () => {
        expect(slideBodyHtml(undefined)).toBe('')
    })
})
