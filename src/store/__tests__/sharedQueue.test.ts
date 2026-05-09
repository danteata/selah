import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAppStore } from '../appStore'

describe('sharedQueueSlideIds', () => {
    beforeEach(() => {
        useAppStore.getState().setSharedQueueSlideIds([])
    })

    it('should set shared queue slide ids', () => {
        useAppStore.getState().setSharedQueueSlideIds(['slide-1', 'slide-2'])
        expect(useAppStore.getState().sharedQueueSlideIds).toEqual(['slide-1', 'slide-2'])
    })

    it('should add shared queue slide ids without duplicates', () => {
        useAppStore.getState().setSharedQueueSlideIds(['slide-1'])
        useAppStore.getState().addSharedQueueSlideIds(['slide-2', 'slide-1'])
        expect(useAppStore.getState().sharedQueueSlideIds).toEqual(['slide-1', 'slide-2'])
    })

    it('should remove shared queue slide ids', () => {
        useAppStore.getState().setSharedQueueSlideIds(['slide-1', 'slide-2', 'slide-3'])
        useAppStore.getState().removeSharedQueueSlideIds(['slide-2'])
        expect(useAppStore.getState().sharedQueueSlideIds).toEqual(['slide-1', 'slide-3'])
    })

    it('should handle removing ids that do not exist', () => {
        useAppStore.getState().setSharedQueueSlideIds(['slide-1'])
        useAppStore.getState().removeSharedQueueSlideIds(['slide-999'])
        expect(useAppStore.getState().sharedQueueSlideIds).toEqual(['slide-1'])
    })

    it('should clear queue when set to empty', () => {
        useAppStore.getState().setSharedQueueSlideIds(['slide-1', 'slide-2'])
        useAppStore.getState().setSharedQueueSlideIds([])
        expect(useAppStore.getState().sharedQueueSlideIds).toEqual([])
    })

    it('should support add and remove for optimistic rollback', () => {
        useAppStore.getState().setSharedQueueSlideIds(['slide-1'])

        // Optimistic add
        useAppStore.getState().addSharedQueueSlideIds(['slide-2', 'slide-3'])
        expect(useAppStore.getState().sharedQueueSlideIds).toEqual(['slide-1', 'slide-2', 'slide-3'])

        // Rollback on failure: remove what was added
        useAppStore.getState().removeSharedQueueSlideIds(['slide-2', 'slide-3'])
        expect(useAppStore.getState().sharedQueueSlideIds).toEqual(['slide-1'])
    })

    it('should support full state rollback via setSharedQueueSlideIds', () => {
        useAppStore.getState().setSharedQueueSlideIds(['slide-1', 'slide-2'])
        const prev = [...useAppStore.getState().sharedQueueSlideIds]

        // Optimistic remove
        useAppStore.getState().removeSharedQueueSlideIds(['slide-2'])
        expect(useAppStore.getState().sharedQueueSlideIds).toEqual(['slide-1'])

        // Rollback on failure: restore previous state
        useAppStore.getState().setSharedQueueSlideIds(prev)
        expect(useAppStore.getState().sharedQueueSlideIds).toEqual(['slide-1', 'slide-2'])
    })
})