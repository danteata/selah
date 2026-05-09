import { describe, it, expect } from 'vitest'
import { canClientPushLiveSlide } from '../liveSessionUtils'

describe('canClientPushLiveSlide', () => {
    it('allows operator when connected and online', () => {
        expect(canClientPushLiveSlide({
            isConnected: true,
            isOffline: false,
            isOperator: true,
            isOpenMode: false,
        })).toBe(true)
    })

    it('allows contributor in open mode when connected and online', () => {
        expect(canClientPushLiveSlide({
            isConnected: true,
            isOffline: false,
            isOperator: false,
            isOpenMode: true,
        })).toBe(true)
    })

    it('rejects updates while offline or disconnected', () => {
        expect(canClientPushLiveSlide({
            isConnected: false,
            isOffline: false,
            isOperator: true,
            isOpenMode: true,
        })).toBe(false)
        expect(canClientPushLiveSlide({
            isConnected: true,
            isOffline: true,
            isOperator: true,
            isOpenMode: true,
        })).toBe(false)
    })
})
