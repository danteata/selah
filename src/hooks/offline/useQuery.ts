import { useRef, useEffect } from 'react'
import { useQuery as useConvexQuery, useQueries as useConvexQueries } from 'convex/react'
import type { FunctionReference, FunctionArgs } from 'convex/server'
import { useConvexConnection } from '../../providers/ConvexConnectionProvider'

type QueryArgs<Query extends FunctionReference<'query'>> =
    | FunctionArgs<Query>
    | 'skip'

export function useQuery<Query extends FunctionReference<'query'>>(
    query: Query,
    args: QueryArgs<Query>,
) {
    const { isOffline, isPlanLimit } = useConvexConnection()
    const skipConvex = isOffline || isPlanLimit

    const effectiveArgs = skipConvex ? 'skip' : args

    try {
        return useConvexQuery(query, effectiveArgs)
    } catch (error) {
        if (
            error instanceof Error &&
            (error.message?.includes('CONVEX') ||
                error.message?.includes('exceeded the free plan') ||
                error.message?.includes('deployments have been disabled') ||
                error.message?.includes('Server Error'))
        ) {
            console.warn('[useQuery] Suppressed Convex error:', error.message?.substring(0, 120))
            return undefined
        }
        throw error
    }
}

export { useQuery as useQueryOriginal } from 'convex/react'