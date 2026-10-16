/// <reference types="vite/client" />
/**
 * Template favourites are the church's, not one person's — and not every
 * church's at once, which is what a list on the shared system templates was.
 * And resetting the built-ins keeps their ids, so defaults and favourites that
 * point at them survive.
 */
import { convexTest } from 'convex-test'
import { describe, it, expect } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const alice = { subject: 'user_alice', email: 'alice@church-a.org', tokenIdentifier: 'clerk|user_alice' }
const carol = { subject: 'user_carol', email: 'carol@church-a.org', tokenIdentifier: 'clerk|user_carol' }
const bob = { subject: 'user_bob', email: 'bob@church-b.org', tokenIdentifier: 'clerk|user_bob' }

async function setup() {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(alice)
    const asCarol = t.withIdentity(carol)
    const asBob = t.withIdentity(bob)
    for (const [as, fullname] of [[asAlice, 'Alice'], [asCarol, 'Carol'], [asBob, 'Bob']] as const) {
        await as.mutation(api.users.upsertUser, { fullname })
    }
    const churchA = await asAlice.mutation(api.churches.createChurch, { name: 'Church A' })
    await asBob.mutation(api.churches.createChurch, { name: 'Church B' })
    // Carol is Alice's teammate.
    await t.run(async (ctx) => {
        const row = await ctx.db.query('users').withIndex('by_email', (q) => q.eq('email', carol.email)).unique()
        await ctx.db.patch(row!._id, { churchId: churchA })
    })
    await asAlice.mutation(api.templates.seedDefaultTemplates, {})
    const silk = (await asAlice.query(api.templates.getTemplates, {})).find((tpl) => tpl.name === 'Silk')!
    return { t, asAlice, asCarol, asBob, silk }
}

type Caller = Awaited<ReturnType<typeof setup>>['asAlice']

const favouriteNames = async (as: Caller) =>
    (await as.query(api.templates.getTemplates, {})).filter((tpl) => tpl.isFavorite).map((tpl) => tpl.name)

describe('template favourites', () => {
    it("are shared by the church and kept from other churches", async () => {
        const { asAlice, asCarol, asBob, silk } = await setup()

        expect(await asAlice.mutation(api.templates.toggleFavoriteTemplate, { templateId: silk._id })).toBe(true)

        expect(await favouriteNames(asAlice)).toEqual(['Silk'])
        expect(await favouriteNames(asCarol)).toEqual(['Silk'])
        expect(await favouriteNames(asBob)).toEqual([])
    })

    it('can be taken off by anyone in the church', async () => {
        const { asAlice, asCarol, silk } = await setup()
        await asAlice.mutation(api.templates.toggleFavoriteTemplate, { templateId: silk._id })

        expect(await asCarol.mutation(api.templates.toggleFavoriteTemplate, { templateId: silk._id })).toBe(false)
        expect(await favouriteNames(asAlice)).toEqual([])
    })

    it('move over from the old per-user lists, once', async () => {
        const { t, asAlice, asBob, silk } = await setup()
        const aliceId = (await asAlice.query(api.users.getCurrentUser, {}))!._id
        await t.run((ctx) => ctx.db.patch(silk._id, { favoritedBy: [aliceId] }))

        expect(await t.mutation(internal.migrations.migrateTemplateFavorites, {})).toEqual({ moved: 1, skipped: 0 })
        expect(await t.mutation(internal.migrations.migrateTemplateFavorites, {})).toEqual({ moved: 0, skipped: 0 })
        expect(await favouriteNames(asAlice)).toEqual(['Silk'])
        expect(await favouriteNames(asBob)).toEqual([])
    })
})

describe('built-in templates', () => {
    it('say which slide types they suit', async () => {
        const { asAlice } = await setup()
        const builtins = await asAlice.query(api.templates.getTemplates, {})
        expect(builtins.find((tpl) => tpl.name === 'Welcome Slide')?.appliesTo).toEqual(['text'])
        expect(builtins.find((tpl) => tpl.name === 'Scripture Verse')?.appliesTo).toEqual(['bible', 'dictionary'])
        expect(builtins.every((tpl) => tpl.appliesTo)).toBe(true)
    })

    it('are scoped when seeded before they said so', async () => {
        const { t, asAlice } = await setup()
        await t.run(async (ctx) => {
            for (const tpl of await ctx.db.query('templates').collect()) await ctx.db.patch(tpl._id, { appliesTo: undefined })
        })
        await asAlice.mutation(api.templates.seedDefaultTemplates, {})
        expect((await asAlice.query(api.templates.getTemplates, {})).every((tpl) => tpl.appliesTo)).toBe(true)
    })

    it('keep their ids, and so their favourites, through a reset', async () => {
        const { t, asAlice, silk } = await setup()
        await asAlice.mutation(api.templates.toggleFavoriteTemplate, { templateId: silk._id })
        await t.run(async (ctx) => {
            const row = await ctx.db.query('users').withIndex('by_email', (q) => q.eq('email', alice.email)).unique()
            await ctx.db.patch(row!._id, { role: 'superadmin' })
        })

        await asAlice.mutation(api.templates.resetDefaultTemplates, {})

        const after = (await asAlice.query(api.templates.getTemplates, {})).find((tpl) => tpl.name === 'Silk')!
        expect(after._id).toBe(silk._id)
        expect(after.isFavorite).toBe(true)
    })
})
