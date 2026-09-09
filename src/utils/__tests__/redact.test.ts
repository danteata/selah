import { describe, it, expect, vi, afterEach } from 'vitest'
import { redactSpeech } from '../redact'

describe('redactSpeech', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('keeps the text readable while developing', () => {
        vi.stubEnv('DEV', true)
        expect(redactSpeech('open Psalm twenty three')).toContain('Psalm')
    })

    it('withholds the text in a production build, keeping only its length', () => {
        // The transcript is a room's speech, not the developer's. A release
        // build must not put it in a log the operator can paste anywhere.
        vi.stubEnv('DEV', false)
        const out = redactSpeech('open Psalm twenty three')
        expect(out).not.toContain('Psalm')
        expect(out).toContain('23')
    })
})
