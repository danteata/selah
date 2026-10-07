import { describe, it, expect } from 'vitest'
import { nonSongReason } from '../songLibraryFilter'

const entry = (title: string, lines: string[]) => ({ title, sections: [{ lines }] })

describe('nonSongReason', () => {
    // Real songs whose titles or lyrics brush against a rule. Dropping any of
    // these from auto-detect would be a silent loss; the filter must not.
    it.each([
        entry('Word of God Speak', ['I\'m finding myself at a loss for words', 'And the funny thing is it\'s okay']),
        entry('He Rules', ['He rules the world with truth and grace']),
        entry('Day by Day', ['Day by day, dear Lord, of thee three things I pray']),
        entry('10000 Reasons', ['Bless the Lord, O my soul', 'Worship His holy name']),
        // A carol that quotes its verse inside the lyric.
        entry('Christmas Rap', [
            'Everybody give glory', 'Christ be the reason for the season', 'Matthew 1:23 Emmanuel God with us',
            'Make we celebrate', 'Christmas is here', 'Merry Christmas to all', 'Sing it loud', 'Isaiah 9:6 a child is born',
            'Everybody sing', 'Glory in the highest', 'Peace on earth', 'Joy to the world', 'Hallelujah',
            'Come and see', 'Born in Bethlehem',
        ]),
        entry('O For a Thousand Tongues to Sing', ['O for a thousand tongues to sing', 'My great Redeemer\'s praise']),
    ])('keeps the song "$title"', (song) => {
        expect(nonSongReason(song)).toBeNull()
    })

    it.each([
        [entry('7 Great Principles of Faith', ['Faith comes by hearing', 'Faith works by love'])],
        [entry('10 reasons why you should tithe', ['God commands it'])],
        [entry('Sunday Announcements', ['Youth meeting on Saturday'])],
        [entry('Prayer Points', ['Pray for the nation'])],
        [entry('Teaching on faith', ['1. Faith pleases God', '2. Faith is the substance', '3. Faith overcomes'])],
        [entry('Notes', ['Faith is the substance... Heb. 11:1', 'Without faith... Heb. 11:6', 'By grace... Eph. 2:8'])],
    ])('flags the non-song %#', (doc) => {
        expect(nonSongReason(doc)).not.toBeNull()
    })
})
