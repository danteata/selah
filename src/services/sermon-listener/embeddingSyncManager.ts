import {
    initializeEmbedder,
    embedBatch,
    isEmbedderReady,
    cacheVerseEmbeddings,
    hasCachedEmbeddings,
    hasFragmentEmbeddings,
    countCachedEmbeddings,
    getCachedVerseEmbeddings,
    clearCachedEmbeddingsForVersion,
    getSyncProgress,
    saveSyncProgress,
    clearSyncProgress,
} from './localEmbeddings'
import { extractVerseFragments } from '../../lib/extractVerseFragments'
import type { BibleVerse } from '../../types'

const BOOK_TO_NUMBER: Record<string, number> = {
    'Genesis': 1, 'Exodus': 2, 'Leviticus': 3, 'Numbers': 4, 'Deuteronomy': 5,
    'Joshua': 6, 'Judges': 7, 'Ruth': 8, '1 Samuel': 9, '2 Samuel': 10,
    '1 Kings': 11, '2 Kings': 12, '1 Chronicles': 13, '2 Chronicles': 14, 'Ezra': 15,
    'Nehemiah': 16, 'Esther': 17, 'Job': 18, 'Psalms': 19, 'Proverbs': 20,
    'Ecclesiastes': 21, 'Song of Solomon': 22, 'Isaiah': 23, 'Jeremiah': 24, 'Lamentations': 25,
    'Ezekiel': 26, 'Daniel': 27, 'Hosea': 28, 'Joel': 29, 'Amos': 30,
    'Obadiah': 31, 'Jonah': 32, 'Micah': 33, 'Nahum': 34, 'Habakkuk': 35,
    'Zephaniah': 36, 'Haggai': 37, 'Zechariah': 38, 'Malachi': 39,
    'Matthew': 40, 'Mark': 41, 'Luke': 42, 'John': 43, 'Acts': 44,
    'Romans': 45, '1 Corinthians': 46, '2 Corinthians': 47, 'Galatians': 48, 'Ephesians': 49,
    'Philippians': 50, 'Colossians': 51, '1 Thessalonians': 52, '2 Thessalonians': 53, '1 Timothy': 54,
    '2 Timothy': 55, 'Titus': 56, 'Philemon': 57, 'Hebrews': 58, 'James': 59,
    '1 Peter': 60, '2 Peter': 61, '1 John': 62, '2 John': 63, '3 John': 64,
    'Jude': 65, 'Revelation': 66,
}

const NUMBER_TO_BOOK: Record<number, string> = {
    1: 'Genesis', 2: 'Exodus', 3: 'Leviticus', 4: 'Numbers', 5: 'Deuteronomy',
    6: 'Joshua', 7: 'Judges', 8: 'Ruth', 9: '1 Samuel', 10: '2 Samuel',
    11: '1 Kings', 12: '2 Kings', 13: '1 Chronicles', 14: '2 Chronicles', 15: 'Ezra',
    16: 'Nehemiah', 17: 'Esther', 18: 'Job', 19: 'Psalms', 20: 'Proverbs',
    21: 'Ecclesiastes', 22: 'Song of Solomon', 23: 'Isaiah', 24: 'Jeremiah', 25: 'Lamentations',
    26: 'Ezekiel', 27: 'Daniel', 28: 'Hosea', 29: 'Joel', 30: 'Amos',
    31: 'Obadiah', 32: 'Jonah', 33: 'Micah', 34: 'Nahum', 35: 'Habakkuk',
    36: 'Zephaniah', 37: 'Haggai', 38: 'Zechariah', 39: 'Malachi',
    40: 'Matthew', 41: 'Mark', 42: 'Luke', 43: 'John', 44: 'Acts',
    45: 'Romans', 46: '1 Corinthians', 47: '2 Corinthians', 48: 'Galatians', 49: 'Ephesians',
    50: 'Philippians', 51: 'Colossians', 52: '1 Thessalonians', 53: '2 Thessalonians', 54: '1 Timothy',
    55: '2 Timothy', 56: 'Titus', 57: 'Philemon', 58: 'Hebrews', 59: 'James',
    60: '1 Peter', 61: '2 Peter', 62: '1 John', 63: '2 John', 64: '3 John',
    65: 'Jude', 66: 'Revelation',
}

export type SyncStage =
    | 'idle'
    | 'downloading'
    | 'loading-model'
    | 'importing'
    | 'generating'
    | 'upgrading'
    | 'caching'
    | 'completed'
    | 'error'

export interface VersionSyncState {
    versionId: string
    stage: SyncStage
    progress: number
    total: number
    startedAt: number | null
    eta: string | null
    error: string | null
    hasEmbeddings: boolean
    hasFragments: boolean
    embeddingCount: number
}

export type SyncListener = (states: Map<string, VersionSyncState>) => void
export interface SyncResult {
    success: boolean
    cancelled?: boolean
    error?: string
}

class EmbeddingSyncManager {
    private states = new Map<string, VersionSyncState>()
    private listeners = new Set<SyncListener>()
    private abortControllers = new Map<string, AbortController>()
    private modelLoading = false
    private modelReady = false

    subscribe(listener: SyncListener): () => void {
        this.listeners.add(listener)
        listener(new Map(this.states))
        return () => {
            this.listeners.delete(listener)
        }
    }

    private notify() {
        const snapshot = new Map(this.states)
        for (const listener of this.listeners) {
            listener(snapshot)
        }
    }

    private updateState(versionId: string, patch: Partial<VersionSyncState>) {
        const existing = this.states.get(versionId)
        const next: VersionSyncState = {
            versionId,
            stage: 'idle',
            progress: 0,
            total: 0,
            startedAt: null,
            eta: null,
            error: null,
            hasEmbeddings: false,
            hasFragments: false,
            embeddingCount: 0,
            ...existing,
            ...patch,
        }
        this.states.set(versionId, next)
        this.notify()
    }

    getStates(): Map<string, VersionSyncState> {
        return new Map(this.states)
    }

    getState(versionId: string): VersionSyncState | undefined {
        return this.states.get(versionId)
    }

    isSyncing(): boolean {
        for (const state of this.states.values()) {
            if (state.stage !== 'idle' && state.stage !== 'completed' && state.stage !== 'error') {
                return true
            }
        }
        return false
    }

    isSyncingVersion(versionId: string): boolean {
        const state = this.states.get(versionId)
        if (!state) return false
        return state.stage !== 'idle' && state.stage !== 'completed' && state.stage !== 'error'
    }

    private isControllerCurrent(versionId: string, controller: AbortController): boolean {
        return this.abortControllers.get(versionId) === controller
    }

    async checkStatus(versionId: string): Promise<VersionSyncState> {
        const [hasEmb, hasFrags, count] = await Promise.all([
            hasCachedEmbeddings(versionId),
            hasFragmentEmbeddings(versionId),
            countCachedEmbeddings(versionId),
        ])
        const existing = this.states.get(versionId)
        const isMidSync = existing && existing.stage !== 'idle' && existing.stage !== 'completed' && existing.stage !== 'error'

        const state: VersionSyncState = {
            versionId,
            stage: isMidSync ? existing.stage : 'idle',
            progress: isMidSync ? existing.progress : 0,
            total: isMidSync ? existing.total : 0,
            startedAt: isMidSync ? existing.startedAt : null,
            eta: isMidSync ? existing.eta : null,
            error: isMidSync ? existing.error : null,
            hasEmbeddings: hasEmb,
            hasFragments: hasFrags,
            embeddingCount: count,
        }
        this.states.set(versionId, state)
        this.notify()
        return state
    }

    async checkAllStatuses(versionIds: string[]): Promise<Map<string, VersionSyncState>> {
        await Promise.all(versionIds.map(id => this.checkStatus(id)))
        return new Map(this.states)
    }

    private calculateEta(progress: number, total: number, startedAt: number): string {
        if (!startedAt || progress === 0) return ''
        const elapsed = Date.now() - startedAt
        const rate = progress / elapsed
        const remaining = total - progress
        const etaMs = remaining / rate
        const etaSeconds = Math.ceil(etaMs / 1000)
        if (etaSeconds < 60) return `${etaSeconds}s remaining`
        const etaMinutes = Math.ceil(etaSeconds / 60)
        if (etaMinutes < 60) return `${etaMinutes}m remaining`
        const etaHours = Math.floor(etaMinutes / 60)
        const remainingMinutes = etaMinutes % 60
        return `${etaHours}h ${remainingMinutes}m remaining`
    }

    async startSync(
        versionId: string,
        getBibleVerses: () => Promise<BibleVerse[] | null>,
        withFragments = false,
    ): Promise<SyncResult> {
        if (this.isSyncingVersion(versionId)) return { success: false, error: 'Sync already in progress' }

        const controller = new AbortController()
        this.abortControllers.set(versionId, controller)
        const signal = controller.signal
        const startedAt = Date.now()

        try {
            this.updateState(versionId, {
                stage: 'loading-model',
                progress: 0,
                total: 0,
                startedAt,
                eta: null,
                error: null,
            })

            if (!isEmbedderReady()) {
                this.modelLoading = true
                const result = await initializeEmbedder()
                this.modelReady = result.ready
                this.modelLoading = false
                if (!result.ready) throw new Error('Failed to load embedding model')
            } else {
                this.modelReady = true
            }

            if (signal.aborted) throw new Error('Sync cancelled')

            this.updateState(versionId, { stage: 'importing' })

            // Read Bible verses from the caller's local cache (IndexedDB →
            // bundled asset → CDN chain in useScripture). The sync manager
            // never fetches from the network or touches Convex.
            const verses = await getBibleVerses()
            if (!verses || verses.length === 0) throw new Error('Bible version file not found')

            // Check for resumable progress before clearing
            const savedProgress = await getSyncProgress(versionId)
            let resumeFrom = 0
            if (savedProgress && savedProgress.withFragments === withFragments) {
                resumeFrom = savedProgress.lastVerseIndex
            }

            // Only clear if starting fresh (not resuming)
            if (resumeFrom === 0) {
                await clearCachedEmbeddingsForVersion(versionId)
            }

            if (signal.aborted) throw new Error('Sync cancelled')

            this.updateState(versionId, {
                stage: 'generating',
                total: verses.length,
                progress: resumeFrom,
            })

            const BATCH_SIZE = 50
            const FLUSH_INTERVAL = 5
            let batchAccumulator: Array<{
                reference: string
                book: string
                bookNumber: number
                chapter: number
                verse: number
                text: string
                embedding: number[]
            }> = []
            let totalEmbedded = 0
            let batchIndex = 0

            if (resumeFrom > 0) {
                const existing = await getCachedVerseEmbeddings(versionId)
                totalEmbedded = existing.length
            }

            for (let i = resumeFrom; i < verses.length; i += BATCH_SIZE) {
                if (signal.aborted) throw new Error('Sync cancelled')

                const batch = verses.slice(i, i + BATCH_SIZE)
                const allTexts: string[] = []
                const fragmentMeta: Array<{ verseIdx: number; type: string; fragmentIndex: number }> = []

                for (let j = 0; j < batch.length; j++) {
                    const verse = batch[j]
                    if (withFragments) {
                        const fragments = extractVerseFragments(verse.scripture)
                        for (const frag of fragments) {
                            allTexts.push(frag.text)
                            fragmentMeta.push({ verseIdx: j, type: frag.type, fragmentIndex: frag.fragmentIndex })
                        }
                    } else {
                        allTexts.push(verse.scripture.trim())
                        fragmentMeta.push({ verseIdx: j, type: 'full', fragmentIndex: 0 })
                    }
                }

                const embeddings = await embedBatch(allTexts)

                for (let metaIdx = 0; metaIdx < fragmentMeta.length; metaIdx++) {
                    const meta = fragmentMeta[metaIdx]
                    const verse = batch[meta.verseIdx]
                    let bookNumber: number
                    let bookName: string
                    const parsedBook = parseInt(verse.book, 10)
                    if (!isNaN(parsedBook)) {
                        bookNumber = parsedBook
                        bookName = NUMBER_TO_BOOK[bookNumber] || verse.book
                    } else {
                        bookNumber = BOOK_TO_NUMBER[verse.book] ?? 0
                        bookName = verse.book
                    }

                    batchAccumulator.push({
                        reference: meta.type === 'full'
                            ? `${bookName} ${verse.chapter}:${verse.verse}`
                            : `${bookName} ${verse.chapter}:${verse.verse}__${meta.type}_${meta.fragmentIndex}`,
                        book: bookName,
                        bookNumber,
                        chapter: parseInt(verse.chapter, 10),
                        verse: parseInt(verse.verse, 10),
                        text: allTexts[metaIdx],
                        embedding: embeddings[metaIdx]?.embedding || [],
                    })
                }

                totalEmbedded += embeddings.length
                batchIndex++

                if (batchIndex % FLUSH_INTERVAL === 0) {
                    this.updateState(versionId, { stage: 'caching' })
                    await cacheVerseEmbeddings(batchAccumulator.map(e => ({
                        ...e,
                        version: versionId,
                        cachedAt: Date.now(),
                    })))
                    batchAccumulator = []
                    await saveSyncProgress({
                        versionId,
                        lastVerseIndex: Math.min(i + BATCH_SIZE, verses.length),
                        totalVerses: verses.length,
                        withFragments,
                        startedAt,
                        updatedAt: Date.now(),
                    })
                    this.updateState(versionId, { stage: 'generating' })
                }

                const currentProgress = Math.min(i + BATCH_SIZE, verses.length)
                const eta = this.calculateEta(currentProgress, verses.length, startedAt)

                this.updateState(versionId, {
                    progress: currentProgress,
                    eta,
                })

                // Yield the main thread so React can paint updates
                if (i + BATCH_SIZE < verses.length) {
                    await new Promise((r) => setTimeout(r, 0))
                }
            }

            if (batchAccumulator.length > 0) {
                this.updateState(versionId, { stage: 'caching' })
                await cacheVerseEmbeddings(batchAccumulator.map(e => ({
                    ...e,
                    version: versionId,
                    cachedAt: Date.now(),
                })))
            }

            await clearSyncProgress(versionId)

            this.updateState(versionId, {
                stage: 'completed',
                progress: verses.length,
                total: verses.length,
                hasEmbeddings: true,
                hasFragments: withFragments,
                embeddingCount: totalEmbedded,
                startedAt: null,
                eta: null,
                error: null,
            })
            return { success: true }
        } catch (error) {
            if (signal.aborted) {
                this.updateState(versionId, { stage: 'idle', error: 'Cancelled', eta: null })
                return { success: false, cancelled: true, error: 'Cancelled' }
            } else {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error'
                this.updateState(versionId, {
                    stage: 'error',
                    error: errorMessage,
                    eta: null,
                })
                return { success: false, error: errorMessage }
            }
        } finally {
            if (this.isControllerCurrent(versionId, controller)) {
                this.abortControllers.delete(versionId)
            }
        }
    }

    async upgradeToFragments(
        versionId: string,
        getBibleVerses: () => Promise<BibleVerse[] | null>,
    ): Promise<SyncResult> {
        if (this.isSyncingVersion(versionId)) return { success: false, error: 'Sync already in progress' }
        const hasFrags = await hasFragmentEmbeddings(versionId)
        if (hasFrags) return { success: true }

        const controller = new AbortController()
        this.abortControllers.set(versionId, controller)
        const signal = controller.signal
        const startedAt = Date.now()

        try {
            this.updateState(versionId, { stage: 'upgrading', progress: 0, total: 0, startedAt, eta: null, error: null })

            if (!isEmbedderReady()) {
                this.modelLoading = true
                const result = await initializeEmbedder()
                this.modelReady = result.ready
                this.modelLoading = false
                if (!result.ready) throw new Error('Failed to load embedding model')
            } else {
                this.modelReady = true
            }

            if (signal.aborted) throw new Error('Sync cancelled')

            // Read Bible verses from the caller's local cache.
            const verses = await getBibleVerses()
            if (!verses || verses.length === 0) throw new Error('Bible version file not found')

            if (signal.aborted) throw new Error('Sync cancelled')

            this.updateState(versionId, { stage: 'upgrading', total: verses.length })

            const BATCH_SIZE = 50
            const FLUSH_INTERVAL = 5
            let batchAccumulator: Array<{
                reference: string
                book: string
                bookNumber: number
                chapter: number
                verse: number
                text: string
                embedding: number[]
            }> = []
            let totalEmbedded = 0
            let batchIndex = 0

            for (let i = 0; i < verses.length; i += BATCH_SIZE) {
                if (signal.aborted) throw new Error('Sync cancelled')

                const batch = verses.slice(i, i + BATCH_SIZE)
                const allTexts: string[] = []
                const fragmentMeta: Array<{ verseIdx: number; type: string; fragmentIndex: number }> = []

                for (let j = 0; j < batch.length; j++) {
                    const verse = batch[j]
                    const fragments = extractVerseFragments(verse.scripture)
                    for (const frag of fragments) {
                        allTexts.push(frag.text)
                        fragmentMeta.push({ verseIdx: j, type: frag.type, fragmentIndex: frag.fragmentIndex })
                    }
                }

                // Skip full-verse fragments — they are already cached. Only embed clause/window fragments.
                const nonFullTexts: string[] = []
                const nonFullMeta: Array<{ verseIdx: number; type: string; fragmentIndex: number }> = []
                for (let k = 0; k < fragmentMeta.length; k++) {
                    if (fragmentMeta[k].type !== 'full') {
                        nonFullTexts.push(allTexts[k])
                        nonFullMeta.push(fragmentMeta[k])
                    }
                }

                if (nonFullTexts.length > 0) {
                    const embeddings = await embedBatch(nonFullTexts)

                    for (let metaIdx = 0; metaIdx < nonFullMeta.length; metaIdx++) {
                        const meta = nonFullMeta[metaIdx]
                        const verse = batch[meta.verseIdx]
                        let bookNumber: number
                        let bookName: string
                        const parsedBook = parseInt(verse.book, 10)
                        if (!isNaN(parsedBook)) {
                            bookNumber = parsedBook
                            bookName = NUMBER_TO_BOOK[bookNumber] || verse.book
                        } else {
                            bookNumber = BOOK_TO_NUMBER[verse.book] ?? 0
                            bookName = verse.book
                        }

                        batchAccumulator.push({
                            reference: `${bookName} ${verse.chapter}:${verse.verse}__${meta.type}_${meta.fragmentIndex}`,
                            book: bookName,
                            bookNumber,
                            chapter: parseInt(verse.chapter, 10),
                            verse: parseInt(verse.verse, 10),
                            text: nonFullTexts[metaIdx],
                            embedding: embeddings[metaIdx]?.embedding || [],
                        })
                    }
                    totalEmbedded += embeddings.length
                }

                batchIndex++

                if (batchIndex % FLUSH_INTERVAL === 0) {
                    this.updateState(versionId, { stage: 'caching' })
                    await cacheVerseEmbeddings(batchAccumulator.map(e => ({
                        ...e,
                        version: versionId,
                        cachedAt: Date.now(),
                    })))
                    batchAccumulator = []
                    await saveSyncProgress({
                        versionId,
                        lastVerseIndex: Math.min(i + BATCH_SIZE, verses.length),
                        totalVerses: verses.length,
                        withFragments: true,
                        startedAt,
                        updatedAt: Date.now(),
                    })
                    this.updateState(versionId, { stage: 'upgrading' })
                }

                const currentProgress = Math.min(i + BATCH_SIZE, verses.length)
                const eta = this.calculateEta(currentProgress, verses.length, startedAt)

                this.updateState(versionId, {
                    progress: currentProgress,
                    eta,
                })

                if (i + BATCH_SIZE < verses.length) {
                    await new Promise((r) => setTimeout(r, 0))
                }
            }

            if (batchAccumulator.length > 0) {
                this.updateState(versionId, { stage: 'caching' })
                await cacheVerseEmbeddings(batchAccumulator.map(e => ({
                    ...e,
                    version: versionId,
                    cachedAt: Date.now(),
                })))
            }

            await clearSyncProgress(versionId)

            this.updateState(versionId, {
                stage: 'completed',
                progress: verses.length,
                total: verses.length,
                hasEmbeddings: true,
                hasFragments: true,
                embeddingCount: totalEmbedded,
                startedAt: null,
                eta: null,
                error: null,
            })
            return { success: true }
        } catch (error) {
            if (signal.aborted) {
                this.updateState(versionId, { stage: 'idle', error: 'Cancelled', eta: null })
                return { success: false, cancelled: true, error: 'Cancelled' }
            } else {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error'
                this.updateState(versionId, {
                    stage: 'error',
                    error: errorMessage,
                    eta: null,
                })
                return { success: false, error: errorMessage }
            }
        } finally {
            if (this.isControllerCurrent(versionId, controller)) {
                this.abortControllers.delete(versionId)
            }
        }
    }

    cancelSync(versionId?: string) {
        if (versionId) {
            this.abortControllers.get(versionId)?.abort()
            return
        }
        for (const controller of this.abortControllers.values()) {
            controller.abort()
        }
    }

    async clearEmbeddings(versionId: string) {
        await clearCachedEmbeddingsForVersion(versionId)
        await clearSyncProgress(versionId)
        this.updateState(versionId, {
            hasEmbeddings: false,
            embeddingCount: 0,
            hasFragments: false,
            stage: 'idle',
            progress: 0,
            total: 0,
            eta: null,
            error: null,
        })
    }

    getModelLoading(): boolean {
        return this.modelLoading
    }

    getModelReady(): boolean {
        return this.modelReady || isEmbedderReady()
    }
}

export const embeddingSyncManager = new EmbeddingSyncManager()
