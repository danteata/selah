import { useQuery as useConvexQuery } from 'convex/react'
import type { FunctionReference, FunctionArgs } from 'convex/server'

const CONNECTION_CONTEXT_KEY = '__selah_convex_offline'

export function setConvexOffline(value: boolean) {
    try {
        if (value) {
            sessionStorage.setItem(CONNECTION_CONTEXT_KEY, '1')
        } else {
            sessionStorage.removeItem(CONNECTION_CONTEXT_KEY)
        }
    } catch {}
}

export function isConvexOffline(): boolean {
    try {
        return sessionStorage.getItem(CONNECTION_CONTEXT_KEY) === '1'
    } catch {
        return false
    }
}

type QueryArgs<Query extends FunctionReference<'query'>> =
    | FunctionArgs<Query>
    | 'skip'

export function useQuery<Query extends FunctionReference<'query'>>(
    query: Query,
    args: QueryArgs<Query>,
) {
    const offline = isConvexOffline()
    const effectiveArgs = offline ? 'skip' : args
    return useConvexQuery(query, effectiveArgs)
}

export { useQuery as useConvexQuery } from 'convex/react'