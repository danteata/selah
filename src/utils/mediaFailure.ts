/**
 * Why a picture or video didn't load, for the operator's preview.
 *
 * - `elsewhere`: a file path from another computer. A slide carries the path
 *   of the computer that added the file, and the desk turned it into a local
 *   address without asking whether the file is here.
 * - `format`: the file is here but this computer can't decode it.
 */
export type MediaFailure = 'elsewhere' | 'format' | 'unavailable'

/** MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED, by value: not every web view has the global. */
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4

const LOCAL_FILE_URL = /^(asset:\/\/|https?:\/\/asset\.localhost\/)/i

/**
 * Tell a missing file from one that won't decode: a media element reports
 * both the same way, so ask for the file's first byte.
 */
export async function explainMediaFailure(src: string, error: MediaError | null): Promise<MediaFailure> {
    if (LOCAL_FILE_URL.test(src)) {
        try {
            const response = await fetch(src, { headers: { Range: 'bytes=0-0' } })
            void response.body?.cancel().catch(() => {})
            return response.ok ? 'format' : 'elsewhere'
        } catch {
            return 'elsewhere'
        }
    }
    return error?.code === MEDIA_ERR_SRC_NOT_SUPPORTED ? 'format' : 'unavailable'
}

const FAILURE_TEXT: Record<MediaFailure, (kind: string) => string> = {
    elsewhere: (kind) => `This ${kind} is on another computer. Sync it to the cloud from that computer's media library to show it here.`,
    format: (kind) => `This computer can't play this ${kind}'s format. Converting it to MP4 (H.264) will make it play.`,
    unavailable: () => "Couldn't load this media",
}

/** What the operator's preview says about a failure, for a 'video' or 'picture'. */
export function mediaFailureText(why: MediaFailure, kind: string): string {
    return FAILURE_TEXT[why](kind)
}
