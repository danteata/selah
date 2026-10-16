/// <reference types="vite/client" />
/**
 * Nothing one church does may delete, hide or break another church's data.
 * Each case here was possible before: naming another church's uploaded file,
 * a table-wide read window filled by one church, and a creator moving church
 * taking their templates along.
 */
import { convexTest } from 'convex-test'
import { describe, it, expect } from 'vitest'
import { api, internal } from './_generated/api'
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
    const churchA = await asAlice.mutation(api.churches.createChurch, { name: 'Church A' })
    const churchB = await asBob.mutation(api.churches.createChurch, { name: 'Church B' })
    const store = (bytes: number) => t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(bytes)])))
    const template = (as: typeof asAlice, name: string) =>
        as.mutation(api.templates.createTemplate, { name, slideId: '{}', category: 'general' })
    const fileExists = async (id: string) => (await t.run((ctx) => ctx.db.system.get(id as never))) !== null
    return { t, asAlice, asBob, churchA, churchB, store, template, fileExists }
}

describe("another church's uploaded files", () => {
    it("can't be attached, so the quota refusal can't delete them", async () => {
        const { asAlice, asBob, store, template, fileExists } = await setup()
        // Bob's church uses a 120 MB video: over any one church's limit.
        const bobsFile = await store(120 * MB)
        await asBob.mutation(api.templates.attachBackground, { templateId: await template(asBob, 'B'), storageId: bobsFile })
            .catch(() => undefined)
        const bobsSmall = await store(MB)
        await asBob.mutation(api.templates.attachBackground, { templateId: await template(asBob, 'B2'), storageId: bobsSmall })

        const mine = await template(asAlice, 'A')
        await expect(asAlice.mutation(api.templates.attachBackground, { templateId: mine, storageId: bobsSmall }))
            .rejects.toThrow(/another church/)
        expect(await fileExists(bobsSmall)).toBe(true)
    })

    it("can't be attached and then replaced to delete them", async () => {
        const { asAlice, asBob, store, template, fileExists } = await setup()
        const bobsFile = await store(MB)
        await asBob.mutation(api.templates.attachBackground, { templateId: await template(asBob, 'B'), storageId: bobsFile })

        const mine = await template(asAlice, 'A')
        await expect(asAlice.mutation(api.templates.attachBackground, { templateId: mine, storageId: bobsFile })).rejects.toThrow()
        await asAlice.mutation(api.templates.attachBackground, { templateId: mine, storageId: await store(MB) })
        expect(await fileExists(bobsFile)).toBe(true)
    })

    it("can't be named in a new template either", async () => {
        const { asAlice, asBob, store, template } = await setup()
        const bobsFile = await store(MB)
        await asBob.mutation(api.templates.attachBackground, { templateId: await template(asBob, 'B'), storageId: bobsFile })
        await expect(asAlice.mutation(api.templates.createTemplate, {
            name: 'Mine', slideId: '{}', category: 'general', backgroundStorageId: bobsFile,
        })).rejects.toThrow(/another church/)
    })

    it('refuses an old file nothing in the church uses, without deleting it', async () => {
        const { t, asAlice, store, template, fileExists } = await setup()
        const old = await store(MB)
        // Age the upload past the six hours a fresh one has.
        const now = Date.now()
        const realNow = Date.now
        Date.now = () => now + 7 * 60 * 60 * 1000
        try {
            await expect(asAlice.mutation(api.templates.attachBackground, { templateId: await template(asAlice, 'A'), storageId: old }))
                .rejects.toThrow(/expired/)
        } finally {
            Date.now = realNow
        }
        expect(await fileExists(old)).toBe(true)
        void t
    })

    it('keeps a replaced background that slides still use', async () => {
        const { t, asAlice, store, template, fileExists } = await setup()
        const id = await template(asAlice, 'A')
        const first = await store(MB)
        await asAlice.mutation(api.templates.attachBackground, { templateId: id, storageId: first })
        // A slide made from the template carries its file.
        await t.run(async (ctx) => {
            const me = (await ctx.db.query('users').collect()).find((u) => u.clerkId === 'user_alice')!
            await ctx.db.insert('slides', {
                id: 's1', index: 0, name: 'Slide', type: 'text', layout: 'full-text', userId: me._id,
                churchId: me.churchId!, scheduleId: 'sched', contents: [], backgroundStorageId: first,
            } as never)
        })
        await asAlice.mutation(api.templates.attachBackground, { templateId: id, storageId: await store(MB) })
        expect(await fileExists(first)).toBe(true)
    })
})

describe('templates', () => {
    it("stay findable however many templates other churches have", async () => {
        const { t, asAlice, churchB } = await setup()
        // Church B fills more than the old 2000-row window.
        await t.run(async (ctx) => {
            for (let i = 0; i < 2100; i++) {
                await ctx.db.insert('templates', {
                    name: `B${i}`, slideId: '{}', category: 'general', createdBy: 'someone', churchId: churchB, createdAt: '', updatedAt: '',
                })
            }
        })
        await asAlice.mutation(api.templates.createTemplate, { name: 'Ours', slideId: '{}', category: 'general' })
        await asAlice.mutation(api.templates.seedDefaultTemplates, {})

        const names = (await asAlice.query(api.templates.getTemplates, {})).map((tpl) => tpl.name)
        expect(names).toContain('Ours')
        expect(names).toContain('Silk')
        expect(names.some((n) => /^B\d+$/.test(n))).toBe(false)
    })

    it('stay with their church when their creator moves to another', async () => {
        const { t, asAlice, asBob, churchB } = await setup()
        await asAlice.mutation(api.templates.createTemplate, { name: 'Ours', slideId: '{}', category: 'general' })
        await t.run(async (ctx) => {
            const me = (await ctx.db.query('users').collect()).find((u) => u.clerkId === 'user_alice')!
            await ctx.db.patch(me._id, { churchId: churchB })
        })
        const bobSees = (await asBob.query(api.templates.getTemplates, {})).map((tpl) => tpl.name)
        expect(bobSees).not.toContain('Ours')
    })

    it('belong to their church after the backfill', async () => {
        const { t, asAlice, churchA } = await setup()
        const id = await t.run(async (ctx) => {
            const me = (await ctx.db.query('users').collect()).find((u) => u.clerkId === 'user_alice')!
            return ctx.db.insert('templates', { name: 'Legacy', slideId: '{}', category: 'general', createdBy: me._id, createdAt: '', updatedAt: '' })
        })
        expect(await t.mutation(internal.migrations.backfillTemplateChurchIds, {})).toMatchObject({ updated: 1 })
        expect((await t.run((ctx) => ctx.db.get(id)))?.churchId).toBe(churchA)
        expect((await asAlice.query(api.templates.getTemplates, {})).map((tpl) => tpl.name)).toContain('Legacy')
    })
})

describe('sermon-listener patterns', () => {
    it("are read by church, so another church's volume can't reach them", async () => {
        const { t, asAlice, churchA, churchB } = await setup()
        await t.run(async (ctx) => {
            for (let i = 0; i < 300; i++) {
                await ctx.db.insert('misheardPatterns', {
                    correctForm: 'John', heardAs: `jon${i}`, patternType: 'book', churchId: churchB,
                    frequency: 1, confidence: 'low', status: 'pending', createdAt: '', updatedAt: '',
                })
            }
        })
        await asAlice.mutation(api.sermonLearning.proposePattern, { correctForm: 'Psalms', heardAs: 'sams', patternType: 'book', churchId: churchA })
        const pending = await asAlice.query(api.sermonLearning.getPendingPatterns, { churchId: churchA })
        expect(pending.map((p) => p.heardAs)).toEqual(['sams'])
    })
})
