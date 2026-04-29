import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useConvex } from 'convex/react'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { useConvexConnection } from '../../providers/ConvexConnectionProvider'
import { getIndexedDB } from '../useIndexedDB'

const DEFAULT_TTL = 5 * 60 * 1000

export interface LocalFirstOptions<Query extends FunctionReference<'query'>> {
    query: Query
    args: FunctionArgs<Query> | 'skip'
    cacheTable: string
    cacheKey: string | ((args: FunctionArgs<Query>) => string)
    ttl?: number
    transformServer?: (data: any) => any
    transformCache?: (data: any) => any
}

export interface LocalFirstResult<T> {
    data: T | null
    isLoading: boolean
    isFromCache: boolean
    isStale: boolean
    error: Error | null
    refetch: () => void
}

export function useLocalFirst<Query extends FunctionReference<'query'>>(
    options: LocalFirstOptions<Query>
): LocalFirstResult<NonNullable<FunctionReturnType<Query>>> {
    const {
        query,
        args,
        cacheTable,
        cacheKey,
        ttl = DEFAULT_TTL,
        transformServer,
        transformCache,
    } = options

    const { isOffline } = useConvexConnection()
    const convex = useConvex()

    const [cachedData, setCachedData] = useState<any>(null)
    const [isFromCache, setIsFromCache] = useState(false)
    const [cacheError, setCacheError] = useState<Error | null>(null)
    const [isStale, setIsStale] = useState(false)
    const initialLoadDone = useRef(false)

    const queryResult = useQuery(
        query,
        (isOffline && cachedData !== null) ? 'skip' : args
    )

    const resolveCacheKey = useCallback(() => {
        if (typeof cacheKey === 'function') {
            return cacheKey(args as any)
        }
        return cacheKey
    }, [cacheKey, args])

    useEffect(() => {
        if (initialLoadDone.current) return

        let cancelled = false
        const loadFromCache = async () => {
            try {
                const db = getIndexedDB()
                const table = (db as any)[cacheTable]
                if (!table) return

                const key = resolveCacheKey()
                const cached = await table.get(key)

                if (cancelled) return

                if (cached) {
                    const data = transformCache ? transformCache(cached) : cached.data ?? cached
                    const age = cached.cachedAt ? Date.now() - new Date(cached.cachedAt).getTime() : Infinity
                    setCachedData(data)
                    setIsFromCache(true)
                    setIsStale(age > ttl)
                }
            } catch (err) {
                console.warn(`[useLocalFirst] Failed to load cache for ${cacheTable}:`, err)
            } finally {
                initialLoadDone.current = true
            }
        }

        loadFromCache()
        return () => { cancelled = true }
    }, [cacheTable, resolveCacheKey, ttl, transformCache])

    useEffect(() => {
        if (queryResult === undefined || queryResult === null) return
        if (isOffline) return

        const data = transformServer ? transformServer(queryResult) : queryResult

        setCachedData(data)
        setIsFromCache(false)
        setIsStale(false)

        const writeToCache = async () => {
            try {
                const db = getIndexedDB()
                const table = (db as any)[cacheTable]
                if (!table) return

                const key = resolveCacheKey()
                await table.put({
                    id: key,
                    data,
                    cachedAt: new Date().toISOString(),
                })
            } catch (err) {
                console.warn(`[useLocalFirst] Failed to write cache for ${cacheTable}:`, err)
            }
        }

        writeToCache()
    }, [queryResult, cacheTable, resolveCacheKey, transformServer, isOffline])

    const refetch = useCallback(async () => {
        if (isOffline) return

        try {
            const result = await convex.query(query as any, args as any)
            if (result !== undefined && result !== null) {
                const data = transformServer ? transformServer(result) : result
                setCachedData(data)
                setIsFromCache(false)
                setIsStale(false)

                const db = getIndexedDB()
                const table = (db as any)[cacheTable]
                if (table) {
                    const key = resolveCacheKey()
                    await table.put({
                        id: key,
                        data,
                        cachedAt: new Date().toISOString(),
                    })
                }
            }
        } catch (err) {
            setCacheError(err instanceof Error ? err : new Error(String(err)))
        }
    }, [convex, query, args, cacheTable, resolveCacheKey, transformServer, isOffline])

    const isLoading = !initialLoadDone.current && cachedData === null && queryResult === undefined

    return {
        data: cachedData ?? queryResult ?? null,
        isLoading,
        isFromCache,
        isStale,
        error: cacheError,
        refetch,
    }
}