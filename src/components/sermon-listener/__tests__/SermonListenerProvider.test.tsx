/**
 * The sermon_listener flag is an off switch: off means no listener at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useEffect } from 'react'

const h = vi.hoisted(() => ({
    flag: true as boolean | 'throws',
    hookCalls: 0,
    mounts: 0,
}))

vi.mock('../../../services/feature-flags', () => ({
    featureFlags: {
        isEnabled: async () => {
            if (h.flag === 'throws') throw new Error('flag service down')
            return h.flag
        },
    },
}))

vi.mock('../../../hooks/useSermonListener', () => ({
    useSermonListener: () => {
        h.hookCalls++
        return { isListening: false, start: async () => true, stop: () => {} }
    },
}))

import { SermonListenerProvider, useSermonListenerContext, useSermonListenerEnabled } from '../SermonListenerContext'

function Consumer() {
    const listener = useSermonListenerContext()
    const enabled = useSermonListenerEnabled()
    useEffect(() => {
        h.mounts++
    }, [])
    return <p>{`enabled=${String(enabled)} listener=${listener ? 'yes' : 'no'}`}</p>
}

async function renderProvider() {
    render(
        <SermonListenerProvider>
            <Consumer />
        </SermonListenerProvider>,
    )
    await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
    })
}

beforeEach(() => {
    h.flag = true
    h.hookCalls = 0
    h.mounts = 0
})

describe('SermonListenerProvider', () => {
    it('with the flag on, provides the one listener', async () => {
        await renderProvider()
        expect(screen.getByText('enabled=true listener=yes')).toBeTruthy()
    })

    it('with the flag off, there is no listener at all', async () => {
        h.flag = false
        await renderProvider()
        expect(screen.getByText('enabled=false listener=no')).toBeTruthy()
        expect(h.hookCalls).toBe(0)
    })

    it('an unreadable flag leaves the listener on, as its default does', async () => {
        h.flag = 'throws'
        await renderProvider()
        expect(screen.getByText('enabled=true listener=yes')).toBeTruthy()
    })

    // Swapping a fragment for a provider when the flag answered remounted the
    // whole workspace under it.
    it('the flag answering does not remount what is under the provider', async () => {
        await renderProvider()
        expect(h.mounts).toBe(1)
    })
})
