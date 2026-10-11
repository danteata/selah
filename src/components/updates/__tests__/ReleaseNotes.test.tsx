import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReleaseNotes } from '../ReleaseNotes'
import { notesForDialog, parseReleaseNotes } from '../../../lib/releaseNotes'

const NOTES = `## Selah 0.1.38

PowerPoint import and smoother NDI.

### Import PowerPoint decks (Pro, desktop app)

- **Bring in the slides you already have.** Pick a \`.pptx\` file.
- Old \`.ppt\` files can't be read;
  save them as \`.pptx\` first.

### Smaller things

- **Fonts show everywhere.**
`

describe('parseReleaseNotes', () => {
    it('reads headings, paragraphs and bullet lists, joining wrapped bullets', () => {
        expect(parseReleaseNotes(NOTES)).toEqual([
            { kind: 'heading', text: 'Selah 0.1.38' },
            { kind: 'paragraph', text: 'PowerPoint import and smoother NDI.' },
            { kind: 'heading', text: 'Import PowerPoint decks (Pro, desktop app)' },
            {
                kind: 'list',
                items: [
                    '**Bring in the slides you already have.** Pick a `.pptx` file.',
                    "Old `.ppt` files can't be read; save them as `.pptx` first.",
                ],
            },
            { kind: 'heading', text: 'Smaller things' },
            { kind: 'list', items: ['**Fonts show everywhere.**'] },
        ])
    })

    it('treats plain text with no Markdown as one paragraph per block', () => {
        expect(parseReleaseNotes('Adds a dictionary.\n\nFixes a crash.')).toEqual([
            { kind: 'paragraph', text: 'Adds a dictionary.' },
            { kind: 'paragraph', text: 'Fixes a crash.' },
        ])
    })
})

describe('notesForDialog', () => {
    it('drops a leading heading that only repeats the version in the title', () => {
        expect(notesForDialog(NOTES, '0.1.38')[0]).toEqual({ kind: 'paragraph', text: 'PowerPoint import and smoother NDI.' })
        expect(notesForDialog(NOTES, '0.1.39')[0]).toEqual({ kind: 'heading', text: 'Selah 0.1.38' })
    })
})

describe('ReleaseNotes', () => {
    it('shows no Markdown syntax', () => {
        const { container } = render(<ReleaseNotes markdown={NOTES} version="0.1.38" />)
        const text = container.textContent ?? ''
        expect(text).not.toMatch(/[#*`]/)
        expect(text).toContain('Bring in the slides you already have.')
        expect(screen.getByText('Bring in the slides you already have.').tagName).toBe('STRONG')
        expect(screen.getByRole('heading', { name: 'Smaller things' })).toBeInTheDocument()
        expect(screen.getAllByRole('listitem')).toHaveLength(3)
    })

    it('never turns the notes into markup', () => {
        const { container } = render(<ReleaseNotes markdown={'- <img src=x onerror=alert(1)> **<b>hi</b>**'} version="1" />)
        expect(container.querySelector('img, b')).toBeNull()
        expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
    })

    it('keeps a link as its text', () => {
        const { container } = render(<ReleaseNotes markdown={'See [the guide](https://example.com).'} version="1" />)
        expect(container.textContent).toBe('See the guide.')
        expect(container.querySelector('a')).toBeNull()
    })
})
