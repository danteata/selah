import { startTransition, useEffect, useState } from 'react'

/**
 * A long list's first rows straight away, the rest in a render that gives way
 * to typing. The songs panel drew every song in the library before it showed
 * at all, so with a few thousand of them it opened late and the search box
 * ignored keys until it had. A short list turning long (the library arriving,
 * a search cleared) starts again from its first rows.
 */
export function useProgressiveList<T>(items: T[], first = 60): T[] {
    const [limit, setLimit] = useState(first)
    const [prevLength, setPrevLength] = useState(items.length)
    if (items.length !== prevLength) {
        setPrevLength(items.length)
        if (prevLength <= first) setLimit(first)
    }
    useEffect(() => {
        if (limit < items.length) startTransition(() => setLimit(Infinity))
    }, [limit, items.length])
    return items.length <= limit ? items : items.slice(0, limit)
}
