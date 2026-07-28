import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { applyThemeClass, readStoredTheme, storeTheme, THEME_STORAGE_KEY } from '../theme'

function setPrefersDark(matches: boolean) {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
        matches,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }))
}

describe('readStoredTheme', () => {
    beforeEach(() => {
        localStorage.clear()
        setPrefersDark(false)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('honours a stored choice over the OS preference', () => {
        setPrefersDark(false)
        localStorage.setItem(THEME_STORAGE_KEY, 'dark')
        expect(readStoredTheme()).toBe(true)

        setPrefersDark(true)
        localStorage.setItem(THEME_STORAGE_KEY, 'light')
        expect(readStoredTheme()).toBe(false)
    })

    it('falls back to the OS preference when nothing is stored', () => {
        setPrefersDark(true)
        expect(readStoredTheme()).toBe(true)

        setPrefersDark(false)
        expect(readStoredTheme()).toBe(false)
    })

    it('survives storage being unavailable', () => {
        const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied')
        })
        setPrefersDark(true)

        expect(readStoredTheme()).toBe(true)
        getItem.mockRestore()
    })

    it('ignores a value it does not recognise', () => {
        localStorage.setItem(THEME_STORAGE_KEY, 'sepia')
        setPrefersDark(true)
        expect(readStoredTheme()).toBe(true)
    })
})

describe('storeTheme', () => {
    beforeEach(() => localStorage.clear())

    it('round-trips through readStoredTheme', () => {
        storeTheme(true)
        expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
        expect(readStoredTheme()).toBe(true)

        storeTheme(false)
        expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
        expect(readStoredTheme()).toBe(false)
    })

    it('does not throw when storage is unavailable', () => {
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota')
        })
        expect(() => storeTheme(true)).not.toThrow()
        setItem.mockRestore()
    })
})

describe('applyThemeClass', () => {
    beforeEach(() => document.documentElement.classList.remove('dark'))

    it('adds and removes the class', () => {
        applyThemeClass(true)
        expect(document.documentElement.classList.contains('dark')).toBe(true)

        applyThemeClass(false)
        expect(document.documentElement.classList.contains('dark')).toBe(false)
    })

    it('is idempotent', () => {
        applyThemeClass(true)
        applyThemeClass(true)
        expect(document.documentElement.className.match(/dark/g)?.length).toBe(1)
    })
})

/**
 * The theme broke because five different places wrote the `dark` class and the
 * last effect to run decided the theme. This is the guard: one writer.
 */
describe('single writer invariant', () => {
    const SRC = join(__dirname, '..', '..')

    function sourceFiles(dir: string, out: string[] = []): string[] {
        for (const entry of readdirSync(dir)) {
            if (entry === '__tests__' || entry === 'node_modules') continue
            const full = join(dir, entry)
            if (statSync(full).isDirectory()) sourceFiles(full, out)
            else if (/\.tsx?$/.test(entry)) out.push(full)
        }
        return out
    }

    it('has exactly one place that writes the dark class', () => {
        const offenders = sourceFiles(SRC)
            .filter((file) => !file.endsWith(join('utils', 'theme.ts')))
            .filter((file) => /classList\s*\.\s*(add|remove|toggle)\(\s*['"]dark['"]/.test(readFileSync(file, 'utf8')))
            .map((file) => file.slice(SRC.length + 1))

        expect(offenders, 'these should call applyThemeClass / the store instead').toEqual([])
    })

    it('has no component reading the theme back off the document', () => {
        // Reading the class to decide the next theme makes the DOM the source of
        // truth for state the store owns, which is how it went out of sync.
        const offenders = sourceFiles(SRC)
            .filter((file) => !file.endsWith(join('utils', 'theme.ts')))
            .filter((file) => /classList\s*\.\s*contains\(\s*['"]dark['"]/.test(readFileSync(file, 'utf8')))
            .map((file) => file.slice(SRC.length + 1))

        expect(offenders, 'read isDarkMode from the store instead').toEqual([])
    })
})
