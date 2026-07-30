import { describe, it, expect } from 'vitest'
import { fontForRun, mergeRuns, parseTextRuns, runsToText, type TextRun } from '../textRuns'

const run = (text: string, extra: Partial<TextRun> = {}): TextRun => ({
    text,
    bold: false,
    italic: false,
    color: null,
    ...extra,
})

describe('parseTextRuns', () => {
    it('keeps plain text as a single run', () => {
        expect(parseTextRuns('<p>Pastor John Mensah</p>')).toEqual([run('Pastor John Mensah')])
    })

    it('carries bold and italic from both tag and inline style', () => {
        expect(parseTextRuns('<p>Pastor <strong>John</strong> Mensah</p>')).toEqual([
            run('Pastor '),
            run('John', { bold: true }),
            run(' Mensah'),
        ])
        expect(parseTextRuns('<p><em>Guest</em></p>')).toEqual([run('Guest', { italic: true })])
        // TipTap's TextStyle mark writes the weight inline rather than using <b>.
        expect(parseTextRuns('<p><span style="font-weight: 700">Bold</span></p>')).toEqual([
            run('Bold', { bold: true }),
        ])
    })

    it('carries the colour the Color mark sets', () => {
        expect(parseTextRuns('<p><span style="color: rgb(255, 0, 0)">Red</span> plain</p>')).toEqual([
            run('Red', { color: 'rgb(255, 0, 0)' }),
            run(' plain'),
        ])
    })

    it('inherits styles through nesting', () => {
        expect(parseTextRuns('<p><strong><span style="color: #ff0000">Both</span></strong></p>')).toEqual([
            run('Both', { bold: true, color: '#ff0000' }),
        ])
    })

    it('ignores a highlight background but keeps its text', () => {
        // A <mark> background would paint a box behind the words; on a keyed
        // graphic the bar already fills that role.
        expect(runsToText(parseTextRuns('<p><mark>Highlighted</mark></p>'))).toBe('Highlighted')
    })

    it('turns block and line breaks into spaces, since the bar is one line', () => {
        expect(runsToText(parseTextRuns('<p>First</p><p>Second</p>'))).toBe('First Second')
        expect(runsToText(parseTextRuns('<p>Line<br>Break</p>'))).toBe('Line Break')
    })

    it('trims the ends and collapses runs of whitespace', () => {
        expect(parseTextRuns('<p>   Padded   name   </p>')).toEqual([run('Padded name')])
    })

    it('returns nothing for empty markup', () => {
        expect(parseTextRuns('')).toEqual([])
        expect(parseTextRuns('<p></p>')).toEqual([])
        expect(parseTextRuns('<p>   </p>')).toEqual([])
    })

    it('decodes entities through the parser', () => {
        expect(runsToText(parseTextRuns('<p>Ampersand &amp; &quot;quotes&quot;</p>'))).toBe('Ampersand & "quotes"')
    })
})

describe('mergeRuns', () => {
    it('joins neighbours that share a style so each draw is one fillText', () => {
        expect(mergeRuns([run('Pas'), run('tor'), run(' John', { bold: true })])).toEqual([
            run('Pastor'),
            run(' John', { bold: true }),
        ])
    })
})

describe('fontForRun', () => {
    it('builds a canvas font string, with bold overriding the base weight', () => {
        expect(fontForRun(run('x'), 48, 'Inter', '400')).toBe('400 48px Inter')
        expect(fontForRun(run('x', { bold: true }), 48, 'Inter', '400')).toBe('700 48px Inter')
        expect(fontForRun(run('x', { italic: true }), 48, 'Inter', '400')).toBe('italic 400 48px Inter')
        expect(fontForRun(run('x'), 48.6, 'Inter', '700')).toBe('700 49px Inter')
    })
})
