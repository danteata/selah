import { describe, it, expect } from 'vitest'

/**
 * Tests for bible reference pattern detection in QuickActionsSidebar
 * 
 * These tests verify that explicit bible references are correctly identified
 * and will show up in search results.
 */

describe('Bible Reference Pattern Detection', () => {
    // Regex pattern from QuickActionsSidebar.tsx
    const looksLikeBibleReference = (input: string): boolean => {
        return /^[1-3]?\s*[a-zA-Z]+\s+\d+/.test(input.trim())
    }

    describe('Standard references', () => {
        it('should match "John 3"', () => {
            expect(looksLikeBibleReference('John 3')).toBe(true)
        })

        it('should match "Psalm 23"', () => {
            expect(looksLikeBibleReference('Psalm 23')).toBe(true)
        })

        it('should match "Psalm 119"', () => {
            expect(looksLikeBibleReference('Psalm 119')).toBe(true)
        })

        it('should match "Genesis 1"', () => {
            expect(looksLikeBibleReference('Genesis 1')).toBe(true)
        })

        it('should match "Revelation 22"', () => {
            expect(looksLikeBibleReference('Revelation 22')).toBe(true)
        })
    })

    describe('Numbered books', () => {
        it('should match "1 John 2"', () => {
            expect(looksLikeBibleReference('1 John 2')).toBe(true)
        })

        it('should match "2 Timothy 3"', () => {
            expect(looksLikeBibleReference('2 Timothy 3')).toBe(true)
        })

        it('should match "3 John 1"', () => {
            expect(looksLikeBibleReference('3 John 1')).toBe(true)
        })

        it('should match "1 Corinthians 13"', () => {
            expect(looksLikeBibleReference('1 Corinthians 13')).toBe(true)
        })

        it('should match "2 Corinthians 5"', () => {
            expect(looksLikeBibleReference('2 Corinthians 5')).toBe(true)
        })

        it('should match "1 Samuel 16"', () => {
            expect(looksLikeBibleReference('1 Samuel 16')).toBe(true)
        })

        it('should match "2 Kings 5"', () => {
            expect(looksLikeBibleReference('2 Kings 5')).toBe(true)
        })

        it('should match "1 Chronicles 29"', () => {
            expect(looksLikeBibleReference('1 Chronicles 29')).toBe(true)
        })

        it('should match "2 Chronicles 7"', () => {
            expect(looksLikeBibleReference('2 Chronicles 7')).toBe(true)
        })

        it('should match "1 Thessalonians 5"', () => {
            expect(looksLikeBibleReference('1 Thessalonians 5')).toBe(true)
        })

        it('should match "2 Thessalonians 2"', () => {
            expect(looksLikeBibleReference('2 Thessalonians 2')).toBe(true)
        })

        it('should match "1 Peter 2"', () => {
            expect(looksLikeBibleReference('1 Peter 2')).toBe(true)
        })

        it('should match "2 Peter 3"', () => {
            expect(looksLikeBibleReference('2 Peter 3')).toBe(true)
        })

        it('should match "1 John 4"', () => {
            expect(looksLikeBibleReference('1 John 4')).toBe(true)
        })

        it('should match "2 John 1"', () => {
            expect(looksLikeBibleReference('2 John 1')).toBe(true)
        })

        it('should match "3 John 1"', () => {
            expect(looksLikeBibleReference('3 John 1')).toBe(true)
        })
    })

    describe('With verse numbers (after colon - should still match book+chapter part)', () => {
        it('should match "John 3" from "John 3:16"', () => {
            // In the actual code, we extract the part before colon first
            const input = 'John 3:16'
            const colonIndex = input.indexOf(':')
            const beforeColon = colonIndex === -1 ? input : input.substring(0, colonIndex)
            expect(looksLikeBibleReference(beforeColon)).toBe(true)
        })

        it('should match "Psalm 23" from "Psalm 23:4"', () => {
            const input = 'Psalm 23:4'
            const colonIndex = input.indexOf(':')
            const beforeColon = colonIndex === -1 ? input : input.substring(0, colonIndex)
            expect(looksLikeBibleReference(beforeColon)).toBe(true)
        })

        it('should match "Psalm 119" from "Psalm 119:157"', () => {
            const input = 'Psalm 119:157'
            const colonIndex = input.indexOf(':')
            const beforeColon = colonIndex === -1 ? input : input.substring(0, colonIndex)
            expect(looksLikeBibleReference(beforeColon)).toBe(true)
        })

        it('should match "1 John 2" from "1 John 2:3"', () => {
            const input = '1 John 2:3'
            const colonIndex = input.indexOf(':')
            const beforeColon = colonIndex === -1 ? input : input.substring(0, colonIndex)
            expect(looksLikeBibleReference(beforeColon)).toBe(true)
        })

        it('should match "2 Corinthians 5" from "2 Corinthians 5:17"', () => {
            const input = '2 Corinthians 5:17'
            const colonIndex = input.indexOf(':')
            const beforeColon = colonIndex === -1 ? input : input.substring(0, colonIndex)
            expect(looksLikeBibleReference(beforeColon)).toBe(true)
        })
    })

    describe('Invalid patterns (should NOT match)', () => {
        it('should not match standalone numbers like "45"', () => {
            expect(looksLikeBibleReference('45')).toBe(false)
        })

        it('should not match just a book name without chapter like "John"', () => {
            expect(looksLikeBibleReference('John')).toBe(false)
        })

        it('should not match empty string', () => {
            expect(looksLikeBibleReference('')).toBe(false)
        })

        it('should not match random words like "the quick brown"', () => {
            expect(looksLikeBibleReference('the quick brown')).toBe(false)
        })
    })

    describe('Case insensitivity', () => {
        it('should match lowercase "john 3"', () => {
            expect(looksLikeBibleReference('john 3')).toBe(true)
        })

        it('should match uppercase "PSALM 23"', () => {
            expect(looksLikeBibleReference('PSALM 23')).toBe(true)
        })

        it('should match mixed case "pSaLM 119"', () => {
            expect(looksLikeBibleReference('pSaLM 119')).toBe(true)
        })
    })

    describe('With extra whitespace', () => {
        it('should match "John  3" with double space', () => {
            expect(looksLikeBibleReference('John  3')).toBe(true)
        })

        it('should match "  John 3  " with leading/trailing spaces', () => {
            expect(looksLikeBibleReference('  John 3  ')).toBe(true)
        })

        it('should match "1  John 2" with space after number', () => {
            expect(looksLikeBibleReference('1  John 2')).toBe(true)
        })
    })
})

describe('Bible Chapter and Verse Parsing', () => {
    // This tests the bibleChapterAndVerse parsing logic
    const parseBibleChapterAndVerse = (searchInput: string): string | undefined => {
        const regex = /\b\d+\s*:\s*\d+\b|\b\d+\s\d+\b/g
        const bibleBookFollowedByJustChapterMatch = searchInput
            ?.replace('/', '')
            .match(/\b\w+\s+\d+\b(?!\S)/g)

        if (
            bibleBookFollowedByJustChapterMatch?.[0] &&
            !searchInput?.match(regex)
        ) {
            const standaloneChapter = Number(
                bibleBookFollowedByJustChapterMatch[0]?.split(' ')?.[1] || 1
            )
            return `${standaloneChapter}:1`
        }

        const match = searchInput
            ?.replace('/', '')
            .match(regex)?.[0]
            ?.replace(/\s*:\s*/g, ':')  // Normalize spaces around colon
            .replace(/\s+/g, ':')       // Replace remaining spaces with colon
        return match?.trim()
    }

    describe('Standard verse references', () => {
        it('should parse "John 3:16" as "3:16"', () => {
            expect(parseBibleChapterAndVerse('John 3:16')).toBe('3:16')
        })

        it('should parse "Psalm 23:4" as "23:4"', () => {
            expect(parseBibleChapterAndVerse('Psalm 23:4')).toBe('23:4')
        })

        it('should parse "Psalm 119:157" as "119:157"', () => {
            expect(parseBibleChapterAndVerse('Psalm 119:157')).toBe('119:157')
        })

        it('should parse "1 John 2:3" as "2:3"', () => {
            expect(parseBibleChapterAndVerse('1 John 2:3')).toBe('2:3')
        })

        it('should parse "2 Corinthians 5:17" as "5:17"', () => {
            expect(parseBibleChapterAndVerse('2 Corinthians 5:17')).toBe('5:17')
        })
    })

    describe('With space instead of colon', () => {
        it('should parse "John 3 16" as "3:16"', () => {
            expect(parseBibleChapterAndVerse('John 3 16')).toBe('3:16')
        })

        it('should parse "Psalm 119 157" as "119:157"', () => {
            expect(parseBibleChapterAndVerse('Psalm 119 157')).toBe('119:157')
        })
    })

    describe('Chapter only (no verse)', () => {
        it('should parse "John 3" as "3:1" (default to verse 1)', () => {
            expect(parseBibleChapterAndVerse('John 3')).toBe('3:1')
        })

        it('should parse "Psalm 23" as "23:1"', () => {
            expect(parseBibleChapterAndVerse('Psalm 23')).toBe('23:1')
        })
    })

    describe('With extra whitespace around colon', () => {
        it('should parse "John 3 : 16" (spaces around colon) as "3:16"', () => {
            expect(parseBibleChapterAndVerse('John 3 : 16')).toBe('3:16')
        })

        it('should parse "Psalm 119 : 157" (spaces around colon) as "119:157"', () => {
            expect(parseBibleChapterAndVerse('Psalm 119 : 157')).toBe('119:157')
        })

        it('should parse "John 3:16" (no spaces around colon) as "3:16"', () => {
            expect(parseBibleChapterAndVerse('John 3:16')).toBe('3:16')
        })

        it('should parse "Psalm 119:157" (no spaces around colon) as "119:157"', () => {
            expect(parseBibleChapterAndVerse('Psalm 119:157')).toBe('119:157')
        })
    })
})
