import { describe, it, expect } from 'vitest'
import { balanceLyricHtml, planLyricBreaks, type MeasureText } from '../lyricLines'

// Monospaced stand-in: every character half an em wide.
const measure: MeasureText = (text) => text.length * 0.5
// A 16:9 slide's text area.
const WIDE = 16 / 9

const parts = (line: string, breaks: number[]) => {
    const words = line.split(' ')
    const bounds = [0, ...breaks, words.length]
    return bounds.slice(0, -1).map((start, i) => words.slice(start, bounds[i + 1]).join(' '))
}

describe('planLyricBreaks', () => {
    it('keeps every line whole when that already fills the frame', () => {
        expect(planLyricBreaks(['Hallelujah', 'Hallelujah'], measure, WIDE)).toBeNull()
    })

    it('splits long lines when a verse would fill only a band of the screen', () => {
        const verse = [
            'Amazing grace, how sweet the sound',
            'That saved a wretch like me',
            'I once was lost, but now am found',
            'Was blind, but now I see',
        ]
        const plan = planLyricBreaks(verse, measure, WIDE)
        expect(plan).not.toBeNull()
        expect(plan!.some((b) => b.length > 0)).toBe(true)
    })

    it('never leaves a word on its own', () => {
        const verse = ['Christ alone, Cornerstone', 'Weak made strong in the Saviour’s love and grace']
        const plan = planLyricBreaks(verse, measure, WIDE) ?? verse.map(() => [])
        verse.forEach((line, i) => {
            for (const part of parts(line, plan[i])) expect(part.split(' ').length).toBeGreaterThanOrEqual(2)
        })
    })

    it('breaks after the comma, where the phrase does', () => {
        const line = 'Amazing grace, how sweet the sound'
        const plan = planLyricBreaks([line, line, line, line], measure, WIDE)
        expect(parts(line, plan![0])).toEqual(['Amazing grace,', 'how sweet the sound'])
    })

    it("doesn't leave a little word hanging at the end of a part", () => {
        const line = 'I dare not trust the sweetest frame'
        const plan = planLyricBreaks([line, line, line, line], measure, WIDE)
        expect(parts(line, plan![0])[0]).toBe('I dare not trust')
    })

    it('leaves the lines alone when the frame is wide enough for them', () => {
        const verse = ['My hope is built on nothing less', 'Than Jesus’ blood and righteousness']
        // A wide, shallow area (a lower-third-like strip).
        expect(planLyricBreaks(verse, measure, 8)).toBeNull()
    })
})

describe('balanceLyricHtml', () => {
    const opts = { font: 'Inter', aspect: WIDE, measure }

    it('breaks plain lines with <br>', () => {
        const html = 'Amazing grace, how sweet the sound<br>That saved a wretch like me<br>I once was lost, but now am found<br>Was blind, but now I see'
        const out = balanceLyricHtml(html, opts)
        expect(out).toContain('Amazing grace,<br>how sweet the sound')
        // The verse's own breaks are all still there.
        expect(out.split('<br>').length).toBeGreaterThan(html.split('<br>').length)
    })

    it('keeps a line with markup in it whole', () => {
        const html = '<p>Amazing grace, how <b>sweet</b> the sound</p><p>That saved a wretch like me and set me free</p><p>I once was lost, but now am found again</p><p>Was blind, but now I see the light</p>'
        const out = balanceLyricHtml(html, opts)
        expect(out).toContain('<p>Amazing grace, how <b>sweet</b> the sound</p>')
    })

    it('returns short verses untouched', () => {
        expect(balanceLyricHtml('Hallelujah<br>Hallelujah', opts)).toBe('Hallelujah<br>Hallelujah')
    })
})
