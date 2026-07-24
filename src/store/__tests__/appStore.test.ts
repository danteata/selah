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

        it('should toggle liveOutputBlanked independently of liveSlideId', () => {
            const store = useAppStore.getState()

            act(() => {
                store.setLiveSlide('slide-123')
                store.setLiveOutputBlanked(true)
            })

            expect(useAppStore.getState().liveOutputBlanked).toBe(true)
            // Clearing the output must not lose the queued slide — that's the
            // whole point of a separate flag rather than nulling liveSlideId.
            expect(useAppStore.getState().liveSlideId).toBe('slide-123')

            act(() => {
                store.setLiveOutputBlanked(false)
            })

            expect(useAppStore.getState().liveOutputBlanked).toBe(false)
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

            expect(useAppStore.getState().activeSlides).toHaveLength(0)
            expect(useAppStore.getState().pastStates).toHaveLength(0)
            expect(useAppStore.getState().futureStates).toHaveLength(1)
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

            expect(useAppStore.getState().activeSlides).toHaveLength(1)
            expect(useAppStore.getState().activeSlides[0].id).toBe('slide-1')
            expect(useAppStore.getState().pastStates).toHaveLength(1)
            expect(useAppStore.getState().futureStates).toHaveLength(0)
        })

        it('should clear futureStates on new mutation after undo', () => {
            const store = useAppStore.getState()
            const slide1: Slide = {
                id: 'slide-1', index: 0, name: 'A', type: 'text',
                layout: 'full-text', userId: '', churchId: '', scheduleId: '', contents: [],
            }
            const slide2: Slide = {
                id: 'slide-2', index: 0, name: 'B', type: 'text',
                layout: 'full-text', userId: '', churchId: '', scheduleId: '', contents: [],
            }

            act(() => {
                store.appendActiveSlide(slide1)
                store.undo()
            })

            expect(useAppStore.getState().futureStates.length).toBe(1)

            act(() => {
                store.appendActiveSlide(slide2)
            })

            expect(useAppStore.getState().futureStates.length).toBe(0)
            expect(useAppStore.getState().activeSlides.length).toBe(1)
            expect(useAppStore.getState().activeSlides[0].id).toBe('slide-2')
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

    describe('replaceSlidesForSchedule merge behavior', () => {
        // Regression: the old implementation filtered out ALL existing local
        // slides for the schedule and replaced them with the server's list.
        // That meant any optimistic local add (e.g. a contributor adding a
        // slide) would be wiped out the moment the server's getSlides query
        // re-fired. The new implementation preserves local-only slides.
        const makeSlide = (overrides: Partial<Slide>): Slide => ({
            id: 'id',
            index: 0,
            name: 'Test',
            type: 'text',
            layout: 'full-text',
            userId: 'user-1',
            churchId: 'church-1',
            scheduleId: 'schedule-a',
            contents: [],
            ...overrides,
        } as Slide)

        it('preserves local-only slides when server response is missing them', () => {
            const store = useAppStore.getState()
            const localOnly = makeSlide({ id: 'local-1', name: 'Local only' })
            const onServer = makeSlide({ id: 'server-1', name: 'Server' })

            act(() => {
                store.setActiveSlides([localOnly, onServer])
            })

            // Server returns only 'server-1' (e.g. local-1 is an optimistic
            // add that hasn't round-tripped yet)
            act(() => {
                store.replaceSlidesForSchedule('schedule-a', [onServer], true)
            })

            const after = useAppStore.getState().activeSlides
            expect(after.some((s) => s.id === 'local-1')).toBe(true)
            expect(after.some((s) => s.id === 'server-1')).toBe(true)
        })

        it('overwrites local data with server data when slide exists on both', () => {
            const store = useAppStore.getState()
            const local = makeSlide({ id: 'shared-1', name: 'Old name' })
            const server = makeSlide({ id: 'shared-1', name: 'New name' })

            act(() => {
                store.setActiveSlides([local])
            })

            act(() => {
                store.replaceSlidesForSchedule('schedule-a', [server], true)
            })

            const after = useAppStore.getState().activeSlides
            expect(after.find((s) => s.id === 'shared-1')?.name).toBe('New name')
        })

        it('appends new server slides that did not exist locally', () => {
            const store = useAppStore.getState()
            const local = makeSlide({ id: 'local-1' })

            act(() => {
                store.setActiveSlides([local])
            })

            act(() => {
                store.replaceSlidesForSchedule('schedule-a', [
                    makeSlide({ id: 'server-new' }),
                ], true)
            })

            const after = useAppStore.getState().activeSlides
            expect(after.some((s) => s.id === 'local-1')).toBe(true)
            expect(after.some((s) => s.id === 'server-new')).toBe(true)
        })

        it('preserves device-local media pointers stripped by the server round-trip', () => {
            // Regression: starting a collab session syncs slides to Convex via
            // toSyncableSlide, which drops localMediaId/localFilePath and nulls
            // the local blob/asset `background`. When the stripped server copy
            // came back and overwrote the local slide, the OWNER lost the
            // pointers needed to resolve their own media and saw the
            // "LOCAL MEDIA" placeholder. The merge must carry those fields over.
            const store = useAppStore.getState()
            const localMedia = makeSlide({
                id: 'media-1',
                type: 'media',
                backgroundType: 'image',
                background: 'blob:http://localhost/abc',
                localMediaId: 'idb-123',
                localFilePath: '/media-library/pic.png',
            })
            // Server copy after the strip: shared fields only, local pointers gone.
            const serverStripped = makeSlide({
                id: 'media-1',
                type: 'media',
                backgroundType: 'image',
                background: undefined,
            })

            act(() => {
                store.setActiveSlides([localMedia])
            })
            act(() => {
                store.replaceSlidesForSchedule('schedule-a', [serverStripped], true)
            })

            const merged = useAppStore.getState().activeSlides.find((s) => s.id === 'media-1')
            expect(merged?.localMediaId).toBe('idb-123')
            expect(merged?.localFilePath).toBe('/media-library/pic.png')
            expect(merged?.background).toBe('blob:http://localhost/abc')
        })

        it('does NOT invent local pointers for a remote collaborator (placeholder stays)', () => {
            // A collaborator who never had the file has no local pointers on
            // their copy, so nothing is restored — they correctly fall through
            // to the placeholder.
            const store = useAppStore.getState()
            const remoteCopy = makeSlide({
                id: 'media-1',
                type: 'media',
                backgroundType: 'image',
                background: undefined,
            })
            const serverStripped = makeSlide({
                id: 'media-1',
                type: 'media',
                backgroundType: 'image',
                background: undefined,
            })

            act(() => {
                store.setActiveSlides([remoteCopy])
            })
            act(() => {
                store.replaceSlidesForSchedule('schedule-a', [serverStripped], true)
            })

            const merged = useAppStore.getState().activeSlides.find((s) => s.id === 'media-1')
            expect(merged?.localMediaId).toBeUndefined()
            expect(merged?.localFilePath).toBeUndefined()
            expect(merged?.background).toBeUndefined()
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
