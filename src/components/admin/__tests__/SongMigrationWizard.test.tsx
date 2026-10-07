import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const parseEasyWorshipDatabases = vi.fn(async () => [])
const parseEasyWorshipFile = vi.fn(async () => ({ songs: [], fileType: 'sqlite', errors: [] }))
vi.mock('../../../services/migration/easyWorshipParser', () => ({
    parseEasyWorshipDatabases: (...args: unknown[]) => parseEasyWorshipDatabases(...(args as [])),
    parseEasyWorshipFile: (...args: unknown[]) => parseEasyWorshipFile(...(args as [])),
    toSelahSong: (s: unknown) => s,
}))
vi.mock('../../../hooks/useSongs', () => ({
    useSongs: () => ({ createSong: vi.fn(), updateSong: vi.fn(), songs: [] }),
}))
vi.mock('../../../providers/ConvexConnectionProvider', () => ({
    useConvexConnection: () => ({ isOffline: false }),
}))
vi.mock('../../../platform', () => ({ isDesktop: () => false }))

import { SongMigrationWizard } from '../SongMigrationWizard'

const file = (name: string) => new File(['x'], name)

function drop(files: File[]) {
    const zone = screen.getByText(/Drop Songs\.db and SongWords\.db here/).closest('[role="button"]')!
    fireEvent.drop(zone, { dataTransfer: { files } })
}

describe('EasyWorship import: adding files', () => {
    beforeEach(() => {
        parseEasyWorshipDatabases.mockClear()
        parseEasyWorshipFile.mockClear()
    })

    it('reads both databases dropped together, whatever their order', async () => {
        render(<SongMigrationWizard />)
        const words = file('SongWords.db')
        const songs = file('Songs.db')
        drop([words, songs])
        await waitFor(() => expect(parseEasyWorshipDatabases).toHaveBeenCalledWith({ songsDb: songs, songWordsDb: words }))
    })

    it('waits for the second file when they arrive one at a time', async () => {
        render(<SongMigrationWizard />)
        drop([file('Songs.db')])
        expect(screen.getByText(/Now add SongWords\.db/)).toBeTruthy()
        expect(parseEasyWorshipDatabases).not.toHaveBeenCalled()
        drop([file('SongWords.db')])
        await waitFor(() => expect(parseEasyWorshipDatabases).toHaveBeenCalledTimes(1))
    })

    it('offers the lyrics alone when only SongWords.db is there', async () => {
        render(<SongMigrationWizard />)
        const words = file('SongWords.db')
        drop([words])
        fireEvent.click(screen.getByText(/import the lyrics without titles/))
        await waitFor(() => expect(parseEasyWorshipFile).toHaveBeenCalledWith(words))
    })

    it('says which dropped file it does not recognise', () => {
        render(<SongMigrationWizard />)
        drop([file('Bibles.db')])
        expect(screen.getByText(/Not an EasyWorship song file: Bibles\.db/)).toBeTruthy()
    })
})
