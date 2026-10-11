import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useProgressiveList } from '../useProgressiveList'

const list = (n: number) => Array.from({ length: n }, (_, i) => i)

describe('useProgressiveList', () => {
    it('ends with every row, even when given a new array each render', () => {
        const { result, rerender } = renderHook(({ n }) => useProgressiveList(list(n), 10), { initialProps: { n: 500 } })
        expect(result.current).toHaveLength(500)
        rerender({ n: 500 })
        expect(result.current).toHaveLength(500)
    })

    it('shows a short list whole', () => {
        const { result } = renderHook(() => useProgressiveList(list(5), 10))
        expect(result.current).toHaveLength(5)
    })

    it('shows the whole list once a short one turns long', () => {
        const { result, rerender } = renderHook(({ n }) => useProgressiveList(list(n), 10), { initialProps: { n: 0 } })
        rerender({ n: 3000 })
        expect(result.current).toHaveLength(3000)
    })
})
