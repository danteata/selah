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
        expect(builtins.find((tpl) => tpl.name === 'Galaxy')?.appliesTo).toEqual(['any'])
        expect(builtins.every((tpl) => tpl.appliesTo)).toBe(true)
    })

    it('are the motion backgrounds, the photo built-ins retired where seeded before', async () => {
        // The photo built-ins linked Unsplash images; one was removed there and
        // its card showed a broken image.
        const { t, asAlice } = await setup()
        await t.run((ctx) => ctx.db.insert('templates', {
            name: 'Prayer Slide', category: 'prayer', slideId: '{}', createdAt: '', updatedAt: '',
            thumbnail: 'https://images.unsplash.com/photo-1508962924756-ee9b9f294d52?q=80&w=1740',
        }))
        await asAlice.mutation(api.templates.seedDefaultTemplates, {})
        const builtins = await asAlice.query(api.templates.getTemplates, {})
        expect(builtins.map((tpl) => tpl.name)).not.toContain('Prayer Slide')
        expect(builtins.every((tpl) => !String(tpl.thumbnail ?? '').includes('unsplash'))).toBe(true)
        expect(builtins.every((tpl) => JSON.parse(tpl.slideId as string).backgroundType === 'motion')).toBe(true)
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

describe('template thumbnails', () => {
    it('drops a thumbnail that is a second copy of the embedded picture, and keeps the rest', async () => {
        const { t, asAlice } = await setup()
        const picture = `data:image/jpeg;base64,${'A'.repeat(2000)}`
        await asAlice.mutation(api.templates.createTemplate, {
            name: 'Twice', category: 'general', thumbnail: picture,
            slideId: JSON.stringify({ backgroundType: 'image', background: picture }),
        })
        await asAlice.mutation(api.templates.createTemplate, {
            name: 'Own thumbnail', category: 'general', thumbnail: 'data:image/jpeg;base64,small',
            slideId: JSON.stringify({ backgroundType: 'image', background: picture }),
        })
        await asAlice.mutation(api.templates.createTemplate, {
            name: 'Linked', category: 'general', thumbnail: 'https://example.org/a.jpg',
            slideId: JSON.stringify({ backgroundType: 'image', background: 'https://example.org/a.jpg' }),
        })

        const result = await t.mutation(internal.migrations.dropDuplicateTemplateThumbnails, {})
        expect(result).toEqual({ dropped: 1, done: true })

        const thumbnails = Object.fromEntries(
            (await asAlice.query(api.templates.getTemplates, {})).filter((tpl) => tpl.createdBy).map((tpl) => [tpl.name, tpl.thumbnail]),
        )
        expect(thumbnails).toEqual({
            Twice: undefined,
            'Own thumbnail': 'data:image/jpeg;base64,small',
            Linked: 'https://example.org/a.jpg',
        })
    })
})
