/**
 * Feature-gated Sermon Listener Panel
 * Only renders if the sermon_listener feature flag is enabled
 */

import { useState, useEffect } from 'react'
import { featureFlags } from '../../services/feature-flags'
import { SermonListenerPanel } from './SermonListenerPanel'

interface FeatureGatedSermonListenerProps {
    autoDisplay?: boolean
    autoLookup?: boolean
    language?: string
    compact?: boolean
    onVerseDetected?: (verse: any, scripture: any) => void
}

export function FeatureGatedSermonListener(props: FeatureGatedSermonListenerProps) {
    const [isEnabled, setIsEnabled] = useState(false)
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        // Check feature flag
        const checkFlag = async () => {
            try {
                const enabled = await featureFlags.isEnabled('sermon_listener', false)
                setIsEnabled(enabled)
            } catch (error) {
                console.warn('Failed to check sermon_listener feature flag:', error)
                setIsEnabled(false)
            } finally {
                setIsLoading(false)
            }
        }
        checkFlag()
    }, [])

    if (isLoading) {
        return null
    }

    if (!isEnabled) {
        return null
    }

    return <SermonListenerPanel {...props} />
}

export default FeatureGatedSermonListener