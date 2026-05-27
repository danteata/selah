/**
 * Structured Logging Bridge
 *
 * Auto-detects desktop vs web environment:
 * - Desktop: sends log messages to the Rust side via Tauri `log_message` command,
 *   which writes to the same file-based log as the Rust backend.
 * - Web: falls back to standard `console.log/warn/error`.
 *
 * Also provides crash detection via `checkPreviousCrash()` (desktop only)
 * and log retrieval via `getLogs()`.
 */

import { isDesktop } from '@/platform'

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

const consoleMap: Record<LogLevel, (...args: unknown[]) => void> = {
    trace: console.log,
    debug: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
}

async function invokeTauri(command: string, args?: Record<string, unknown>): Promise<unknown> {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke(command, args)
}

function formatContext(context?: Record<string, unknown>): string {
    if (!context) return ''
    try {
        return ' ' + JSON.stringify(context)
    } catch {
        return ''
    }
}

async function logToRust(level: LogLevel, message: string, context?: Record<string, unknown>): Promise<void> {
    if (!isDesktop()) return
    try {
        await invokeTauri('log_message', {
            level,
            message,
            context: formatContext(context),
        })
    } catch {
        // If Tauri invoke fails, we've already logged to console
    }
}

export const logger = {
    trace(message: string, context?: Record<string, unknown>) {
        consoleMap.trace(`[trace] ${message}`, context)
        logToRust('trace', message, context)
    },

    debug(message: string, context?: Record<string, unknown>) {
        consoleMap.debug(`[debug] ${message}`, context)
        logToRust('debug', message, context)
    },

    info(message: string, context?: Record<string, unknown>) {
        consoleMap.info(`[info] ${message}`, context)
        logToRust('info', message, context)
    },

    warn(message: string, context?: Record<string, unknown>) {
        consoleMap.warn(`[warn] ${message}`, context)
        logToRust('warn', message, context)
    },

    error(message: string, context?: Record<string, unknown>) {
        consoleMap.error(`[error] ${message}`, context)
        logToRust('error', message, context)
    },
}

export async function getLogs(maxLines?: number): Promise<string[]> {
    if (!isDesktop()) {
        return ['Log retrieval is only available in the desktop app']
    }
    try {
        const logs = await invokeTauri('get_logs', { maxLines }) as string[]
        return logs
    } catch (e) {
        return [`Failed to retrieve logs: ${e}`]
    }
}

export async function checkPreviousCrash(): Promise<boolean> {
    if (!isDesktop()) return false
    try {
        const crashed = await invokeTauri('check_previous_crash') as boolean
        return crashed
    } catch {
        return false
    }
}