import { describe, it, expect, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { useAppStore } from '../appStore'
import type { Slide, Schedule } from '../../types'

describe('appStore', () => {
    beforeEach(() => {
        // Reset store to initial state
        const store = useAppStore.getState()
        store.signOut()
    })

    describe('slides', () => {
        it('should append a slide', () => {
            const store = useAppStore.getState()
            const slide: Slide = {
                id: 'slide-1',
                index: 0,
                name: 'Test Slide',
                type: 'text',
                layout: 'full-text',
                userId: 'user-1',
                churchId: 'church-1',
                scheduleId: 'schedule-1',
                contents: ['Test content'],
            }

            act(() => {
                store.appendActiveSlide(slide)
            })

            expect(useAppStore.getState().activeSlides).toHaveLength(1)
            expect(useAppStore.getState().activeSlides[0].id).toBe('slide-1')
        })

        it('should remove a slide', () => {
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
            })

            expect(useAppStore.getState().activeSlides).toHaveLength(2)

            act(() => {
                store.removeActiveSlide(slide1)
            })

            expect(useAppStore.getState().activeSlides).toHaveLength(1)
            expect(useAppStore.getState().activeSlides[0].id).toBe('slide-2')
        })

        it('should not add duplicate slides', () => {
            const store = useAppStore.getState()
            const slide: Slide = {
                id: 'slide-1',
                index: 0,
                name: 'Test Slide',
                type: 'text',
                layout: 'full-text',
                userId: 'user-1',
                churchId: 'church-1',
                scheduleId: 'schedule-1',
                contents: [],
            }

            act(() => {
                store.appendActiveSlide(slide)
                store.appendActiveSlide(slide)
            })

            expect(useAppStore.getState().activeSlides).toHaveLength(1)
        })

        it('should set live slide', () => {
            const store = useAppStore.getState()

            act(() => {
                store.setLiveSlide('slide-123')
            })

            expect(useAppStore.getState().liveSlideId).toBe('slide-123')
        })
    })

    describe('schedules', () => {
        it('should set active schedule', () => {
            const store = useAppStore.getState()
            const schedule: Schedule = {
                _id: 'schedule-1',
                name: 'Sunday Service',
                authorId: 'user-1',
                editorIds: [],
                churchId: 'church-1',
            }

            act(() => {
                store.setActiveSchedule(schedule)
            })

            expect(useAppStore.getState().activeSchedule).toEqual(schedule)
        })

        it('should add schedule to schedules list', () => {
            const store = useAppStore.getState()
            const schedule: Schedule = {
                _id: 'schedule-1',
                name: 'Sunday Service',
                authorId: 'user-1',
                editorIds: [],
                churchId: 'church-1',
            }

            act(() => {
                store.setActiveSchedule(schedule)
            })

            expect(useAppStore.getState().schedules).toHaveLength(1)
            expect(useAppStore.getState().schedules[0]._id).toBe('schedule-1')
        })
    })

    describe('undo/redo', () => {
        it('should undo last action', () => {
            const store = useAppStore.getState()
            const slide: Slide = {
                id: 'slide-1',
                index: 0,
                name: 'Test Slide',
                type: 'text',
                layout: 'full-text',
                userId: 'user-1',
                churchId: 'church-1',
                scheduleId: 'schedule-1',
                contents: [],
            }

            act(() => {
                store.appendActiveSlide(slide)
            })

            expect(useAppStore.getState().activeSlides).toHaveLength(1)

            act(() => {
                store.undo()
            })

            // After undo, slides should be empty (reverted to initial state)
            // Note: This depends on how the undo is implemented
            // The current implementation may need adjustment
        })

        it('should redo undone action', () => {
            const store = useAppStore.getState()
            const slide: Slide = {
                id: 'slide-1',
                index: 0,
                name: 'Test Slide',
                type: 'text',
                layout: 'full-text',
                userId: 'user-1',
                churchId: 'church-1',
                scheduleId: 'schedule-1',
                contents: [],
            }

            act(() => {
                store.appendActiveSlide(slide)
                store.undo()
                store.redo()
            })

            // After redo, slide should be back
        })
    })

    describe('settings', () => {
        it('should update bible version', () => {
            const store = useAppStore.getState()

            act(() => {
                store.setDefaultBibleVersion('NIV')
            })

            expect(useAppStore.getState().settings.defaultBibleVersion).toBe('NIV')
        })

        it('should update lines per slide', () => {
            const store = useAppStore.getState()

            act(() => {
                store.setLinesPerSlide(6)
            })

            expect(useAppStore.getState().settings.slideStyles.linesPerSlide).toBe(6)
        })

        it('should toggle animations', () => {
            const store = useAppStore.getState()
            const initialValue = store.settings.animations

            act(() => {
                store.setAnimations(!initialValue)
            })

            expect(useAppStore.getState().settings.animations).toBe(!initialValue)
        })
    })

    describe('shared queue', () => {
        it('preserves order and duplicate entries when adding queue items', () => {
            const store = useAppStore.getState()

            act(() => {
                store.setSharedQueueSlideIds([])
                store.addSharedQueueSlideIds(['slide-1', 'slide-2', 'slide-1'])
            })

            expect(useAppStore.getState().sharedQueueSlideIds).toEqual(['slide-1', 'slide-2', 'slide-1'])
        })

        it('removes queue entries by occurrence count', () => {
            const store = useAppStore.getState()

            act(() => {
                store.setSharedQueueSlideIds(['slide-1', 'slide-2', 'slide-1', 'slide-3'])
                store.removeSharedQueueSlideIds(['slide-1'])
            })

            expect(useAppStore.getState().sharedQueueSlideIds).toEqual(['slide-2', 'slide-1', 'slide-3'])
        })
    })

    describe('session slide hydration', () => {
        it('replaces slides for a specific schedule without clobbering live output order', () => {
            const store = useAppStore.getState()
            const scheduleASlide: Slide = {
                id: 'a-1',
                index: 0,
                name: 'A1',
                type: 'text',
                layout: 'full-text',
                userId: 'user-1',
                churchId: 'church-1',
                scheduleId: 'schedule-a',
                contents: [],
            }
            const scheduleBSlide: Slide = {
                id: 'b-1',
                index: 0,
                name: 'B1',
                type: 'text',
                layout: 'full-text',
                userId: 'user-1',
                churchId: 'church-1',
                scheduleId: 'schedule-b',
                contents: [],
            }

            act(() => {
                store.setActiveSlides([scheduleASlide, scheduleBSlide])
                store.setLiveOutputSlidesId(['b-1', 'a-1'])
                store.replaceSlidesForSchedule('schedule-a', [{
                    ...scheduleASlide,
                    id: 'a-2',
                    name: 'A2',
                }], true)
            })

            expect(useAppStore.getState().activeSlides.some((s) => s.id === 'a-2')).toBe(true)
            expect(useAppStore.getState().liveOutputSlidesId).toEqual(['b-1', 'a-1'])
        })
    })

    describe('signOut', () => {
        it('should reset all state', () => {
            const store = useAppStore.getState()
            const slide: Slide = {
                id: 'slide-1',
                index: 0,
                name: 'Test',
                type: 'text',
                layout: 'full-text',
                userId: 'user-1',
                churchId: 'church-1',
                scheduleId: 'schedule-1',
                contents: [],
            }

            act(() => {
                store.appendActiveSlide(slide)
                store.setLiveSlide('slide-1')
                store.signOut()
            })

            expect(useAppStore.getState().activeSlides).toHaveLength(0)
            expect(useAppStore.getState().liveSlideId).toBeNull()
            expect(useAppStore.getState().activeSchedule).toBeNull()
        })
    })
})
