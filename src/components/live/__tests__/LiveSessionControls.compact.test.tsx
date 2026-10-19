import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { getFunctionName } from 'convex/server'

const h = vi.hoisted(() => ({
    queries: {} as Record<string, unknown>,
    mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
}))

vi.mock('convex/react', () => ({
    useQuery: (ref: unknown, args: unknown) => (args === 'skip' ? undefined : h.queries[getFunctionName(ref as never)]),
    useMutation: (ref: unknown) => {
        const name = getFunctionName(ref as never)
        h.mutations[name] ??= vi.fn(async () => null)
        return h.mutations[name]
    },
}))
vi.mock('../../../hooks/useUserRole', () => ({ useUserRole: () => ({ currentUser: { _id: 'u1', churchId: 'c1' } }) }))
vi.mock('../../../hooks/useSchedules', () => ({
    useSchedules: () => ({ activeSchedule: { _id: 'sch1' }, schedules: [{ _id: 'sch1' }], setActiveSchedule: () => {} }),
}))
vi.mock('../../../providers/ConvexConnectionProvider', () => ({ useConvexConnection: () => ({ isOffline: false }) }))

import { LiveSessionControls } from '../LiveSessionControls'

const people = [
    { userId: 'u1', user: { fullname: 'Ama Mensah' }, sessionRole: 'operator' },
    { userId: 'u2', user: { fullname: 'Kofi Boateng' }, sessionRole: 'contributor' },
]

function inSession(operatorId: string, users = people) {
    const session = { _id: 'sess1', status: 'active', operatorId, scheduleId: 'sch1', collaborationMode: 'moderated' }
    h.queries = {
        'liveSessions:getActiveSession': session,
        'liveSessions:getActiveSessionByChurch': [session],
        'presence:getPresenceBySession': users,
    }
}

describe('LiveSessionControls, compact (the phone)', () => {
    beforeEach(() => {
        h.queries = {}
        h.mutations = {}
    })

    it('offers to start a session when there is none', () => {
        render(<LiveSessionControls churchId="c1" compact />)
        fireEvent.click(screen.getByRole('button', { name: /start session/i }))
        expect(h.mutations['liveSessions:startSession']).toHaveBeenCalled()
    })

    it("shows the operator one chip, and End and Hand over in its sheet", () => {
        inSession('u1')
        render(<LiveSessionControls churchId="c1" compact />)

        // One control in the strip, not a row of badges that runs off a phone.
        expect(screen.queryByRole('button', { name: /end session/i })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: /^Live session, Review mode, you are Operator/ }))

        expect(screen.getByText('Kofi Boateng')).not.toBeNull()
        fireEvent.click(screen.getByRole('button', { name: /hand over/i }))
        fireEvent.click(screen.getByRole('button', { name: 'Kofi Boateng' }))
        expect(h.mutations['liveSessions:transferOperator']).toHaveBeenCalledWith({ sessionId: 'sess1', newOperatorId: 'u2' })
    })

    it('lets the operator end the session from the sheet', () => {
        inSession('u1')
        render(<LiveSessionControls churchId="c1" compact />)
        fireEvent.click(screen.getByRole('button', { name: /^Live session/ }))
        fireEvent.click(screen.getByRole('button', { name: /end session/i }))
        expect(h.mutations['liveSessions:endSession']).toHaveBeenCalledWith({ sessionId: 'sess1' })
    })

    it('lets the operator change who can drive the screen, mid-session', () => {
        // The mode was fixed by Settings when the session started.
        inSession('u1')
        render(<LiveSessionControls churchId="c1" compact />)
        fireEvent.click(screen.getByRole('button', { name: /^Live session/ }))
        const modes = screen.getByRole('radiogroup', { name: 'Who can change slides' })
        expect(screen.getByRole('radio', { name: 'Review' })).toHaveAttribute('aria-checked', 'true')
        fireEvent.click(within(modes).getByRole('radio', { name: 'Open' }))
        expect(h.mutations['liveSessions:updateCollaborationMode']).toHaveBeenCalledWith({ sessionId: 'sess1', collaborationMode: 'open' })
    })

    it("doesn't offer a contributor the mode switch", () => {
        inSession('u9', [{ userId: 'u1', user: { fullname: 'Ama Mensah' }, sessionRole: 'contributor' }])
        render(<LiveSessionControls churchId="c1" compact />)
        fireEvent.click(screen.getByRole('button', { name: /you are Contributor/ }))
        expect(screen.queryByRole('radiogroup', { name: 'Who can change slides' })).toBeNull()
    })

    it('lets a contributor leave', () => {
        inSession('u9', [{ userId: 'u1', user: { fullname: 'Ama Mensah' }, sessionRole: 'contributor' }])
        render(<LiveSessionControls churchId="c1" compact />)
        fireEvent.click(screen.getByRole('button', { name: /you are Contributor/ }))
        fireEvent.click(screen.getByRole('button', { name: /leave session/i }))
        expect(h.mutations['liveSessions:leaveSession']).toHaveBeenCalledWith({ sessionId: 'sess1' })
    })

    it('lets someone not yet in the session join to help or just watch', () => {
        inSession('u9', [{ userId: 'u9', user: { fullname: 'Kofi Boateng' }, sessionRole: 'operator' }])
        render(<LiveSessionControls churchId="c1" compact />)
        fireEvent.click(screen.getByRole('button', { name: /^Live session/ }))
        fireEvent.click(screen.getByRole('button', { name: /join to help/i }))
        expect(h.mutations['liveSessions:joinSession']).toHaveBeenCalledWith({ sessionId: 'sess1', role: 'contributor' })
    })
})
