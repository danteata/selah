import { isDesktop } from '../../platform'
import type { QuickAction } from '../../types'

export const DESKTOP_ONLY_HINT = 'Available in Selah desktop'

/**
 * Why an action can't run here, or null when it can. Desktop-only actions stay
 * listed on the web, so people find them, but disabled with this hint.
 */
export function quickActionUnavailableReason(action: Pick<QuickAction, 'desktopOnly'>): string | null {
    return action.desktopOnly && !isDesktop() ? DESKTOP_ONLY_HINT : null
}
