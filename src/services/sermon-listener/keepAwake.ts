/**
 * Keep-Awake Service
 *
 * Prevents the OS from sleeping during long sermon recordings.
 *
 * Desktop (Tauri): uses tauri-plugin-keepawake
 * Web: uses Screen Wake Lock API (navigator.wakeLock)
 *
 * Both locks are released when stopKeepAwake() is called or on error.
 */

import { isDesktop } from '@/platform'

let wakeLockSentinel: WakeLockSentinel | null = null
let keepAwakeActive = false

/**
 * Check if the Screen Wake Lock API is available in the browser.
 */
function isWakeLockAvailable(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator
}

/**
 * Start keep-awake using the Screen Wake Lock API (browser fallback).
 */
async function startWebKeepAwake(): Promise<boolean> {
    if (!isWakeLockAvailable()) {
        console.warn('[KeepAwake] Screen Wake Lock API not available in this browser')
        return false
    }

    try {
        wakeLockSentinel = await navigator.wakeLock.request('screen')
        keepAwakeActive = true

        wakeLockSentinel.addEventListener('release', () => {
            keepAwakeActive = false
            wakeLockSentinel = null
        })

        console.log('[KeepAwake] Screen Wake Lock acquired')
        return true
    } catch (error) {
        console.warn('[KeepAwake] Failed to acquire Screen Wake Lock:', error)
        return false
    }
}

/**
 * Stop the Screen Wake Lock (browser).
 */
async function stopWebKeepAwake(): Promise<void> {
    if (wakeLockSentinel) {
        try {
            await wakeLockSentinel.release()
        } catch {
            // Sentinel may have already been released (e.g. tab hidden)
        }
        wakeLockSentinel = null
    }
    keepAwakeActive = false
}

/**
 * Start keep-awake using Tauri plugin (desktop).
 */
async function startDesktopKeepAwake(): Promise<boolean> {
    try {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('plugin:keepawake|start', { display: true, idle: true, sleep: true })
        keepAwakeActive = true
        console.log('[KeepAwake] Tauri keep-awake started')
        return true
    } catch (error) {
        // Plugin may not be installed/compiled — fall back to web API
        console.warn('[KeepAwake] Tauri keep-awake plugin not available, falling back to web API:', error)
        return startWebKeepAwake()
    }
}

/**
 * Stop Tauri keep-awake.
 */
async function stopDesktopKeepAwake(): Promise<void> {
    try {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('plugin:keepawake|stop')
    } catch {
        // Ignore — fall through to web cleanup
    }
    keepAwakeActive = false
}

/**
 * Start keep-awake. Prevents the device from sleeping during sermon recording.
 *
 * On desktop (Tauri), uses the keepawake plugin.
 * On web, uses the Screen Wake Lock API.
 * Falls back gracefully if either is unavailable.
 */
export async function startKeepAwake(): Promise<boolean> {
    if (keepAwakeActive) {
        console.log('[KeepAwake] Already active')
        return true
    }

    if (isDesktop()) {
        return startDesktopKeepAwake()
    }
    return startWebKeepAwake()
}

/**
 * Stop keep-awake. Call this when recording stops, including in finally blocks.
 */
export async function stopKeepAwake(): Promise<void> {
    if (isDesktop()) {
        await stopDesktopKeepAwake()
    }
    await stopWebKeepAwake()
}

/**
 * Check if keep-awake is currently active.
 */
export function isKeepAwakeActive(): boolean {
    return keepAwakeActive
}

/**
 * Re-acquire keep-awake when the page becomes visible again.
 * The Screen Wake Lock API releases when the tab is hidden,
 * so we need to re-request on visibility change.
 *
 * Call this once at app startup to set up the listener.
 */
export function setupVisibilityKeepAwake(): () => void {
    const handleVisibilityChange = async () => {
        if (document.visibilityState === 'visible' && keepAwakeActive && !wakeLockSentinel) {
            console.log('[KeepAwake] Page visible again, re-acquiring Screen Wake Lock')
            await startWebKeepAwake()
        }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
}