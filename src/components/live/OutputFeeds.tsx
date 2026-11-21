import { useAlternateOutput } from '../../hooks/useAlternateOutput'

/**
 * Keeps the alternate output's NDI feed running whatever the desk shows.
 * The feed is driven by whichever component using useAlternateOutput mounted
 * first, and that used to be Live Output: hide or close the panel and the
 * feed stopped. Mounted once, in the shell. Renders nothing.
 */
export function OutputFeeds() {
    useAlternateOutput()
    return null
}
