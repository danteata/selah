import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '../appStore'
import type { Schedule, Slide } from '../../types'

const local: Schedule = { _id: 'schedule_1', name: 'Sunday', authorId: '', editorIds: [], churchId: 'c1', createdAt: '', updatedAt: '' }
const slide = (id: string, scheduleId: string): Slide =>
    ({ id, index: 0, name: id, type: 'text', layout: 'full-text', userId: '', churchId: '', scheduleId, contents: [] })

describe('remapScheduleId', () => {
    beforeEach(() => useAppStore.getState().signOut())

    it('moves an offline schedule and its slides onto the server id', () => {
        useAppStore.setState({
            schedules: [local],
            activeSchedule: local,
            activeSlides: [slide('s1', 'schedule_1'), slide('s2', 'other')],
        })

        useAppStore.getState().remapScheduleId('schedule_1', 'srv_1')

        const state = useAppStore.getState()
        expect(state.schedules.map((s) => s._id)).toEqual(['srv_1'])
        expect(state.activeSchedule?._id).toBe('srv_1')
        expect(state.activeSlides.map((s) => s.scheduleId)).toEqual(['srv_1', 'other'])
    })

    it('does not duplicate a schedule the server list already brought in', () => {
        useAppStore.setState({ schedules: [local, { ...local, _id: 'srv_1' }], activeSchedule: local })

        useAppStore.getState().remapScheduleId('schedule_1', 'srv_1')

        expect(useAppStore.getState().schedules.map((s) => s._id)).toEqual(['srv_1'])
    })
})
