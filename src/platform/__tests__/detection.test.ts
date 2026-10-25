import { describe, it, expect, afterEach, vi } from 'vitest'
import { isDesktop, isTauri, isTauriMobile, isWeb } from '../index'

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0'

function inTauri(userAgent: string) {
    vi.stubGlobal('navigator', { ...navigator, userAgent })
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
}

describe('platform detection', () => {
    afterEach(() => {
        delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
        vi.unstubAllGlobals()
    })

    it('is the desk in Tauri on a computer', () => {
        inTauri(WINDOWS)
        expect(isTauri()).toBe(true)
        expect(isDesktop()).toBe(true)
        expect(isTauriMobile()).toBe(false)
    })

    it('is the phone app, not the desk, in Tauri on Android', () => {
        // The desk's commands (monitors, NDI, audio) don't exist there, so it
        // takes the web paths.
        inTauri(ANDROID)
        expect(isTauriMobile()).toBe(true)
        expect(isTauri()).toBe(false)
        expect(isDesktop()).toBe(false)
        expect(isWeb()).toBe(true)
    })

    it('is the web in a browser, phone or not', () => {
        vi.stubGlobal('navigator', { ...navigator, userAgent: ANDROID })
        expect(isTauriMobile()).toBe(false)
        expect(isWeb()).toBe(true)
    })
})
