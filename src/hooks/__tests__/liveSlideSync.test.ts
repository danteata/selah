import { describe, it, expect } from 'vitest'
import { diffScheduleSlides, removedOnServer, slideKey } from '../liveSlideSync'

const slide = (id: string, text = id) => ({ id, contents: [text] })

describe('diffScheduleSlides', () => {
    it('writes only slides whose content changed', () => {
        const baseline = new Map([['a', slideKey(slide('a'))], ['b', slideKey(slide('b'))]])
        const { upserts, deletes } = diffScheduleSlides(baseline, [slide('a'), slide('b', 'edited'), slide('c')])

        expect(upserts.map((s) => s.id)).toEqual(['b', 'c'])
        expect(deletes).toEqual([])
    })

    it('deletes only slides this device had and removed', () => {
        const baseline = new Map([['a', slideKey(slide('a'))], ['gone', slideKey(slide('gone'))]])
        const { deletes } = diffScheduleSlides(baseline, [slide('a')])

        expect(deletes).toEqual(['gone'])
    })

    it("never deletes a slide it hasn't seen — a collaborator's still on its way", () => {
        // The old sync sent the whole deck and the server deleted whatever was
        // missing: exactly this case, deleted for everyone.
        const { deletes } = diffScheduleSlides(new Map(), [slide('mine')])
        expect(deletes).toEqual([])
    })
})

describe('removedOnServer', () => {
    it('reports slides the server had last time and no longer does', () => {
        expect(removedOnServer(new Set(['a', 'b']), new Set(['a']))).toEqual(['b'])
    })

    it('leaves alone slides the server never had', () => {
        expect(removedOnServer(new Set(['a']), new Set(['a', 'new']))).toEqual([])
    })
})
