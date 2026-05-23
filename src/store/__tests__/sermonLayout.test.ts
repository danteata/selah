import { describe, it, expect, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { useAppStore } from '../appStore'
import type { Slide } from '../../types'

describe('appStore — sermon/bible layout', () => {
    beforeEach(() => {
        const store = useAppStore.getState()
        store.signOut()
    })

    describe('openBibleFromSermon', () => {
        it('navigates to bible section and sets query', () => {
            const store = useAppStore.getState()

            act(() => {
                store.openBibleFromSermon('John 3:16')
            })

            const state = useAppStore.getState()
            expect(state.activeNavSection).toBe('bible')
            expect(state.contextPanelOpen).toBe(true)
            expect(state.biblePanelQuery).toBe('John 3:16')
        })

        it('does not set splitPanelMode (removed for unified Bible panel)', () => {
            const store = useAppStore.getState()

            act(() => {
                store.openBibleFromSermon('Psalm 23:1')
            })

            const state = useAppStore.getState()
            expect(state.splitPanelMode).toBeNull()
            expect(state.splitPanelQuery).toBeNull()
        })

        it('overwrites previous biblePanelQuery', () => {
            const store = useAppStore.getState()

            act(() => {
                store.openBibleFromSermon('Genesis 1:1')
            })

            expect(useAppStore.getState().biblePanelQuery).toBe('Genesis 1:1')

            act(() => {
                store.openBibleFromSermon('Revelation 22:21')
            })

            expect(useAppStore.getState().biblePanelQuery).toBe('Revelation 22:21')
        })
    })

    describe('setActiveNavSection', () => {
        it('opens context panel when selecting a section', () => {
            const store = useAppStore.getState()

            act(() => {
                store.setContextPanelOpen(false)
                store.setActiveNavSection('bible')
            })

            expect(useAppStore.getState().contextPanelOpen).toBe(true)
            expect(useAppStore.getState().activeNavSection).toBe('bible')
        })

        it('toggles section off when clicking the same section', () => {
            const store = useAppStore.getState()

            act(() => {
                store.setActiveNavSection('sermon')
            })

            expect(useAppStore.getState().activeNavSection).toBe('sermon')

            act(() => {
                store.setActiveNavSection(null)
            })

            expect(useAppStore.getState().activeNavSection).toBeNull()
        })

        it('splitPanelMode remains when leaving sermon section (no longer auto-cleared)', () => {
            const store = useAppStore.getState()

            act(() => {
                store.setActiveNavSection('sermon')
                store.setSplitPanelMode('sermon-bible')
            })

            expect(useAppStore.getState().splitPanelMode).toBe('sermon-bible')

            act(() => {
                store.setActiveNavSection('bible')
            })

            expect(useAppStore.getState().activeNavSection).toBe('bible')
            expect(useAppStore.getState().splitPanelMode).toBe('sermon-bible')
        })

        it('splitPanelQuery remains when leaving sermon section (no longer auto-cleared)', () => {
            const store = useAppStore.getState()

            act(() => {
                store.setActiveNavSection('sermon')
                store.setSplitPanelQuery('Matthew 5:1')
                store.setActiveNavSection('bible')
            })

            expect(useAppStore.getState().splitPanelQuery).toBe('Matthew 5:1')
        })
    })

    describe('sermon-to-bible workflow', () => {
        it('complete flow: detect verse → open in Bible panel → verify state', () => {
            const store = useAppStore.getState()

            act(() => {
                store.setActiveNavSection('sermon')
            })

            expect(useAppStore.getState().activeNavSection).toBe('sermon')

            act(() => {
                store.openBibleFromSermon('Romans 8:28')
            })

            const state = useAppStore.getState()
            expect(state.activeNavSection).toBe('bible')
            expect(state.contextPanelOpen).toBe(true)
            expect(state.biblePanelQuery).toBe('Romans 8:28')
            expect(state.splitPanelMode).toBeNull()
            expect(state.splitPanelQuery).toBeNull()
        })
    })

    describe('workspace mode', () => {
        it('switches between studio and dashboard modes', () => {
            const store = useAppStore.getState()

            act(() => {
                store.setWorkspaceMode('dashboard')
            })

            expect(useAppStore.getState().workspaceMode).toBe('dashboard')

            act(() => {
                store.setWorkspaceMode('studio')
            })

            expect(useAppStore.getState().workspaceMode).toBe('studio')
        })
    })

    describe('sermon panel duplication prevention', () => {
        it('sermon nav section active with panel open means sidebar is showing sermon', () => {
            const store = useAppStore.getState()

            act(() => {
                store.setActiveNavSection('sermon')
            })

            const state = useAppStore.getState()
            const sermonDuplicatedInSidebar = state.activeNavSection === 'sermon' && state.contextPanelOpen

            expect(sermonDuplicatedInSidebar).toBe(true)
        })

        it('sermon nav section with panel closed means sidebar is NOT showing sermon', () => {
            const store = useAppStore.getState()

            act(() => {
                store.setActiveNavSection('sermon')
                store.setContextPanelOpen(false)
            })

            const state = useAppStore.getState()
            const sermonDuplicatedInSidebar = state.activeNavSection === 'sermon' && state.contextPanelOpen

            expect(sermonDuplicatedInSidebar).toBe(false)
        })

        it('bible nav section active means sidebar is NOT showing sermon', () => {
            const store = useAppStore.getState()

            act(() => {
                store.setActiveNavSection('bible')
            })

            const state = useAppStore.getState()
            const sermonDuplicatedInSidebar = state.activeNavSection === 'sermon' && state.contextPanelOpen

            expect(sermonDuplicatedInSidebar).toBe(false)
        })

        it('closing sermon nav section means sidebar is NOT showing sermon', () => {
            const store = useAppStore.getState()

            act(() => {
                store.setActiveNavSection('sermon')
                store.setActiveNavSection(null)
            })

            const state = useAppStore.getState()
            const sermonDuplicatedInSidebar = state.activeNavSection === 'sermon' && state.contextPanelOpen

            expect(sermonDuplicatedInSidebar).toBe(false)
        })
    })
})

describe('appStore — live output presentation', () => {
    beforeEach(() => {
        const store = useAppStore.getState()
        store.signOut()
    })

    it('liveSlideId can be set and read', () => {
        const store = useAppStore.getState()

        act(() => {
            store.setLiveSlide('slide-live-1')
        })

        expect(useAppStore.getState().liveSlideId).toBe('slide-live-1')
    })

    it('liveSlideId can be cleared', () => {
        const store = useAppStore.getState()

        act(() => {
            store.setLiveSlide('slide-live-1')
            store.setLiveSlide(null)
        })

        expect(useAppStore.getState().liveSlideId).toBeNull()
    })

    it('liveOutputSlidesId tracks slide order for output', () => {
        const store = useAppStore.getState()

        const slide1: Slide = {
            id: 'slide-1',
            index: 0,
            name: 'Slide 1',
            type: 'text',
            layout: 'full-text',
            userId: 'user-1',
            churchId: 'church-1',
            scheduleId: 'schedule-1',
            contents: [],
        }
        const slide2: Slide = {
            id: 'slide-2',
            index: 1,
            name: 'Slide 2',
            type: 'text',
            layout: 'full-text',
            userId: 'user-1',
            churchId: 'church-1',
            scheduleId: 'schedule-1',
            contents: [],
        }

        act(() => {
            store.appendActiveSlide(slide1)
            store.appendActiveSlide(slide2)
            store.setLiveOutputSlidesId(['slide-1', 'slide-2'])
        })

        expect(useAppStore.getState().liveOutputSlidesId).toEqual(['slide-1', 'slide-2'])
    })

    it('context panel state persists across workspace mode switches', () => {
        const store = useAppStore.getState()

        act(() => {
            store.setActiveNavSection('bible')
            store.setWorkspaceMode('dashboard')
        })

        expect(useAppStore.getState().activeNavSection).toBe('bible')
        expect(useAppStore.getState().contextPanelOpen).toBe(true)
    })
})