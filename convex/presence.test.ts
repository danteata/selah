/// <reference types="vite/client" />
/**
 * Presence: who counts as here, and pings that would change nothing.
 */
import { convexTest } from 'convex-test'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const alice = { subject: 'user_alice', email: 'alice@church-a.org', tokenIdentifier: 'clerk|user_alice' }

const T0 = Date.parse('2026-10-25T09:00:00.000Z')
const MINUTE = 60_000

/** Set the clock the functions read. */
function at(ms: number) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(ms)
}

async function setup() {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(alice)
    await asAlice.mutation(api.users.upsertUser, { fullname: 'Alice' })
    const churchId = (await asAlice.mutation(api.churches.createChurch, { name: 'Church A' })) as string
    const lastSeen = () => t.run(async (ctx) => (await ctx.db.query('presence').first())?.lastSeen)
    const here = async () => (await asAlice.query(api.presence.getPresenceByChurch, { churchId })).length > 0
    return { asAlice, lastSeen, here }
}

describe('presence', () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    it('keeps someone outside a session listed between their slower pings', async () => {
        const { asAlice, here } = await setup()
        at(T0)
        await asAlice.mutation(api.presence.heartbeat, { location: 'dashboard' })

        at(T0 + 3 * MINUTE)
        expect(await here()).toBe(true)
        at(T0 + 6 * MINUTE)
        expect(await here()).toBe(false)
    })

    it('drops someone in a live session after a few missed pings', async () => {
        const { asAlice, here } = await setup()
        at(T0)
        await asAlice.mutation(api.presence.heartbeat, { location: 'live' })

        at(T0 + MINUTE)
        expect(await here()).toBe(true)
        at(T0 + 2 * MINUTE)
        expect(await here()).toBe(false)
    })

    it("doesn't write a ping that changes nothing moments after the last", async () => {
        const { asAlice, lastSeen } = await setup()
        at(T0)
        await asAlice.mutation(api.presence.heartbeat, { location: 'dashboard' })

        at(T0 + 15_000)
        await asAlice.mutation(api.presence.heartbeat, { location: 'dashboard' })
        expect(await lastSeen()).toBe(T0)

        // Something changed: written at once.
        await asAlice.mutation(api.presence.heartbeat, { location: 'away' })
        expect(await lastSeen()).toBe(T0 + 15_000)

        at(T0 + 40_000)
        await asAlice.mutation(api.presence.heartbeat, { location: 'away' })
        expect(await lastSeen()).toBe(T0 + 40_000)
    })
})
