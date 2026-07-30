/**
 * The alternate output — a second, independent output alongside the main one.
 *
 * Modelled on how presentation software treats outputs generally: the output is
 * the thing you configure, and where it lands (a monitor, or the network as an
 * NDI source) is one of its settings rather than a separate feature.
 */

/** Where the output goes. A monitor and an NDI stream are peers. */
export type AlternateDestination =
    | { kind: 'monitor'; monitorId: string }
    | { kind: 'ndi' }

/**
 * What the output shows.
 *   - `follow`: the live content, rendered by this output's own settings — the
 *     usual case for a stage display or a keyed feed of the same item.
 *   - `independent`: a slide sent to this output specifically, so the projector
 *     and this output can show unrelated things at the same time.
 */
export type AlternateContentSource = 'follow' | 'independent'

/** Frame size and rate, used when there's no monitor to inherit them from. */
export interface OutputFormat {
    width: number
    height: number
    fps: number
}

export interface AlternateOutputConfig {
    enabled: boolean
    destination: AlternateDestination
    format: OutputFormat
    /**
     * Keep transparency in the feed so a switcher can key it over video. Only
     * meaningful for the NDI destination — a monitor has nothing behind it.
     */
    alpha: boolean
    contentSource: AlternateContentSource
    /** NDI source name, so several machines on one network stay distinguishable. */
    sourceName: string
}

export const OUTPUT_FORMATS: readonly OutputFormat[] = [
    { width: 1280, height: 720, fps: 30 },
    { width: 1280, height: 720, fps: 60 },
    { width: 1920, height: 1080, fps: 30 },
    { width: 1920, height: 1080, fps: 60 },
] as const

export function formatLabel(format: OutputFormat): string {
    return `${format.width} × ${format.height}  ${format.fps} Hz`
}

export const DEFAULT_ALTERNATE_OUTPUT: AlternateOutputConfig = {
    enabled: false,
    // NDI by default: it needs no spare monitor, so it is the destination most
    // operators can actually try.
    destination: { kind: 'ndi' },
    format: { width: 1920, height: 1080, fps: 30 },
    alpha: true,
    contentSource: 'independent',
    sourceName: 'Selah Alternate',
}
