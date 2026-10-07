/// <reference types="vite/client" />
/**
 * Template backgrounds on the server: attaching an uploaded file, and the
 * church's 100 MB limit.
 */
import { convexTest } from 'convex-test'
import { describe, it, expect } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const MB = 1024 * 1024

const alice = { subject: 'user_alice', email: 'alice@church-a.org', tokenIdentifier: 'clerk|user_alice' }
const bob = { subject: 'user_bob', email: 'bob@church-b.org', tokenIdentifier: 'clerk|user_bob' }

async function setup() {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(alice)
    const asBob = t.withIdentity(bob)
    await asAlice.mutation(api.users.upsertUser, { fullname: 'Alice' })
    await asBob.mutation(api.users.upsertUser, { fullname: 'Bob' })
    await asAlice.mutation(api.churches.createChurch, { name: 'Church A' })
    await asBob.mutation(api.churches.createChurch, { name: 'Church B' })
    const store = (bytes: number) => t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(bytes)])))
    const template = (as: typeof asAlice, name: string) =>
        as.mutation(api.templates.createTemplate, {
            name,
            slideId: JSON.stringify({ type: 'text', backgroundType: 'video', localFilePath: '/Users/a/b.mp4' }),
            category: 'general',
        })
    return { t, asAlice, asBob, store, template }
}

describe('attachBackground', () => {
    it('gives the template the uploaded file, in its snapshot too', async () => {
        const { t, asAlice, store, template } = await setup()
        const id = await template(asAlice, 'Galaxy')
        const file = await store(2 * MB)
        const result = await asAlice.mutation(api.templates.attachBackground, { templateId: id, storageId: file })
        expect(result).toMatchObject({ ok: true, usedBytes: 2 * MB, limitBytes: 100 * MB })
        const saved = await t.run((ctx) => ctx.db.get(id))
        expect(saved?.backgroundStorageId).toBe(file)
        expect(JSON.parse(saved!.slideId as string).backgroundStorageId).toBe(file)
    })

    it('refuses a file that takes the church past 100 MB, and deletes it', async () => {
        const { t, asAlice, store, template } = await setup()
        await asAlice.mutation(api.templates.attachBackground, { templateId: await template(asAlice, 'One'), storageId: await store(60 * MB) })
        const second = await template(asAlice, 'Two')
        const big = await store(50 * MB)
        const result = await asAlice.mutation(api.templates.attachBackground, { templateId: second, storageId: big })
        expect(result).toMatchObject({ ok: false, usedBytes: 60 * MB })
        expect(await t.run((ctx) => ctx.db.system.get(big))).toBeNull()
        expect((await asAlice.query(api.templates.backgroundUsage, {})).usedBytes).toBe(60 * MB)
    })

    it('counts a replaced background only once, and removes the old file', async () => {
        const { t, asAlice, store, template } = await setup()
        const id = await template(asAlice, 'Galaxy')
        const first = await store(40 * MB)
        await asAlice.mutation(api.templates.attachBackground, { templateId: id, storageId: first })
        const result = await asAlice.mutation(api.templates.attachBackground, { templateId: id, storageId: await store(70 * MB) })
        expect(result.ok).toBe(true)
        expect(await t.run((ctx) => ctx.db.system.get(first))).toBeNull()
    })

    it("each church has its own limit, and can't touch another's templates", async () => {
        const { asAlice, asBob, store, template } = await setup()
        await asAlice.mutation(api.templates.attachBackground, { templateId: await template(asAlice, 'A'), storageId: await store(90 * MB) })
        const bobs = await template(asBob, 'B')
        expect((await asBob.mutation(api.templates.attachBackground, { templateId: bobs, storageId: await store(90 * MB) })).ok).toBe(true)
        await expect(
            asBob.mutation(api.templates.attachBackground, { templateId: await template(asAlice, 'A2'), storageId: await store(MB) }),
        ).rejects.toThrow(/not found/)
    })

    it('applies the limit to a background saved with the template itself', async () => {
        const { asAlice, store } = await setup()
        await asAlice.mutation(api.templates.createTemplate, {
            name: 'Big', slideId: '{}', category: 'general', backgroundStorageId: await store(80 * MB),
        })
        await expect(asAlice.mutation(api.templates.createTemplate, {
            name: 'Bigger', slideId: '{}', category: 'general', backgroundStorageId: await store(30 * MB),
        })).rejects.toThrow(/100 MB/)
    })
})

describe('deleting a media library item', () => {
    it('keeps the file while a template uses it as its background', async () => {
        const { t, asAlice, store, template } = await setup()
        const file = await store(MB)
        await asAlice.mutation(api.templates.attachBackground, { templateId: await template(asAlice, 'Uses it'), storageId: file })
        const mediaId = await t.run(async (ctx) => {
            const me = (await ctx.db.query('users').collect()).find((u) => u.clerkId === 'user_alice')!
            return ctx.db.insert('mediaLibrary', {
                name: 'clip', type: 'video', storageId: file, createdBy: me._id, churchId: me.churchId, createdAt: '', updatedAt: '',
            } as never)
        })
        await asAlice.mutation(api.media.deleteMediaLibraryItem, { mediaId })
        expect(await t.run((ctx) => ctx.db.system.get(file))).not.toBeNull()
    })
})
