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

/** A pushed channel's health (Rust `PushStats`). */
export interface PushStats {
    /** Frames handed over. */
    submitted: number
    /** Frames sent to NDI, repeats included. */
    sent: number
    /** Handed over but replaced by a newer frame before it went out. */
    replacedUnsent: number
    /** Ticks with nothing new, which re-sent the last frame. */
    repeated: number
    /** Ticks that came round late. */
    lateTicks: number
    fps: number
}

export const EMPTY_PUSH_STATS: PushStats = { submitted: 0, sent: 0, replacedUnsent: 0, repeated: 0, lateTicks: 0, fps: 0 }

export interface PushFrame {
    /** RGBA, tightly packed, straight (unpremultiplied) alpha. */
    pixels: Uint8Array
    width: number
    height: number
}

class NdiPushChannelService {
    /**
     * Announce the source at `fps`. Safe to call repeatedly with the same name
     * and rate. From then on the source runs at that rate on its own: the last
     * frame pushed is repeated until a new one arrives, so frames only need
     * pushing when the picture changes.
     */
    async open(channelId: string, sourceName: string, fps?: number): Promise<void> {
        const invoke = await getInvoke()
        if (!invoke) throw new Error('NDI output requires the desktop app')
        await invoke('ndi_push_open', { channelId, sourceName, fps })
    }

    async close(channelId: string): Promise<void> {
        const invoke = await getInvoke()
        if (!invoke) return
        await invoke('ndi_push_close', { channelId })
    }

    /**
     * Push one frame. Returns once it's in the channel's one-frame mailbox; the
     * next tick sends it, and a newer frame pushed first replaces it. Rejects if
     * the channel isn't open or the buffer size contradicts the dimensions.
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

    /** Frames sent, dropped, repeated and late on a channel. */
    async stats(channelId: string): Promise<PushStats> {
        const invoke = await getInvoke()
        if (!invoke) return EMPTY_PUSH_STATS
        try {
            return await invoke<PushStats>('ndi_push_stats', { channelId })
        } catch {
            return EMPTY_PUSH_STATS
        }
    }

    /** Frames NDI has actually accepted — "announced" vs "sending". */
    async framesSent(channelId: string): Promise<number> {
        return (await this.stats(channelId)).sent
    }
}

export const ndiPushChannelService = new NdiPushChannelService()
