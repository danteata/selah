import { describe, it, expect } from 'vitest'
import { addsToDeck, refusal, roleFor, type LanCommand } from '../protocol'

describe('who runs the screen from a phone', () => {
    it("is the desk's own user, or an admin of its church", () => {
        const desk = { id: 'u1', churchId: 'c1' }
        expect(roleFor({ id: 'u1' }, desk)).toBe('operator')
        expect(roleFor({ id: 'u2', role: 'admin', churchId: 'c1' }, desk)).toBe('operator')
        expect(roleFor({ id: 'u2', role: 'admin', churchId: 'c2' }, desk)).toBe('contributor')
        expect(roleFor({ id: 'u2', role: 'member' }, desk)).toBe('contributor')
        // Nobody known on either side: a paired phone contributes.
        expect(roleFor(null, null)).toBe('contributor')
        expect(roleFor({}, {})).toBe('contributor')
    })
})

describe("the desk's rules, which are Convex's", () => {
    it('lets a contributor change the live slide only in open mode', () => {
        const live = { k: 'live', slideId: 's1' } as const
        expect(refusal(live, 'contributor', 'moderated')).toMatch(/operator/)
        expect(refusal(live, 'contributor', 'strict')).toMatch(/operator/)
        expect(refusal(live, 'contributor', 'open')).toBeNull()
        expect(refusal(live, 'operator', 'strict')).toBeNull()
    })

    it('keeps contributors from adding in strict mode, and from the operator-only controls', () => {
        expect(refusal({ k: 'add', slides: [] }, 'contributor', 'strict')).toMatch(/strict/)
        expect(refusal({ k: 'add', slides: [] }, 'contributor', 'moderated')).toBeNull()
        const operatorOnly: LanCommand[] = [
            { k: 'accept', slideIds: [] },
            { k: 'reorderQueue', slideIds: [] },
            { k: 'deck', slideIds: [] },
            { k: 'blank', on: true },
            { k: 'mode', mode: 'open' },
        ]
        for (const cmd of operatorOnly) {
            expect(refusal(cmd, 'contributor', 'open')).not.toBeNull()
            expect(refusal(cmd, 'operator', 'strict')).toBeNull()
        }
        expect(refusal({ k: 'unqueue', slideIds: [] }, 'contributor', 'strict')).toBeNull()
    })

    it('puts a contributor\'s slides up for review unless the session is open', () => {
        expect(addsToDeck('contributor', 'moderated')).toBe(false)
        expect(addsToDeck('contributor', 'open')).toBe(true)
        expect(addsToDeck('operator', 'moderated')).toBe(true)
    })
})
