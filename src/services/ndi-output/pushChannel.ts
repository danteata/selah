/**
 * Pushed NDI channels — an NDI source fed by frames this app renders, rather
 * than by capturing a window.
 *
 * This is what lets an alternate output (lower thirds, say) carry different
 * content from the program output *and* real transparency: window capture only
 * ever yields opaque, composited pixels.
 *
 * Frames go over the IPC as a raw binary body with their metadata in headers.
 * Not as a command argument: that serialises a Uint8Array as a JSON array of
 * numbers, about 30 MB of text for one 1080p frame.
 */

function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window
}

async function getInvoke() {
    if (!isTauri()) return null
    try {
        const { invoke } = await import('@tauri-apps/api/core')
        return invoke
    } catch {
        return null
    }
}

/** Channel id for the graphics / lower-thirds feed. */
export const GRAPHICS_CHANNEL = 'graphics'

export interface PushFrame {
    /** RGBA, tightly packed, straight (unpremultiplied) alpha. */
    pixels: Uint8Array
    width: number
    height: number
}

class NdiPushChannelService {
    /** Announce the source. Safe to call repeatedly with the same name. */
    async open(channelId: string, sourceName: string): Promise<void> {
        const invoke = await getInvoke()
        if (!invoke) throw new Error('NDI output requires the desktop app')
        await invoke('ndi_push_open', { channelId, sourceName })
    }

    async close(channelId: string): Promise<void> {
        const invoke = await getInvoke()
        if (!invoke) return
        await invoke('ndi_push_close', { channelId })
    }

    /**
     * Push one frame. Rejects if the channel isn't open or the buffer size
     * contradicts the dimensions — both are checked in Rust before the pixels are
     * handed to NDI.
     */
    async sendFrame(channelId: string, frame: PushFrame): Promise<void> {
        const invoke = await getInvoke()
        if (!invoke) return
        await invoke('ndi_push_frame', frame.pixels, {
            headers: {
                'x-ndi-channel': channelId,
                'x-ndi-width': String(frame.width),
                'x-ndi-height': String(frame.height),
            },
        })
    }

    /** Frames NDI has actually accepted — "announced" vs "sending". */
    async framesSent(channelId: string): Promise<number> {
        const invoke = await getInvoke()
        if (!invoke) return 0
        try {
            return await invoke<number>('ndi_push_frames_sent', { channelId })
        } catch {
            return 0
        }
    }
}

export const ndiPushChannelService = new NdiPushChannelService()
