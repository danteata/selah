import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Clean up after each test
afterEach(() => {
    cleanup()
})

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
})

// Mock IntersectionObserver
class MockIntersectionObserver {
    observe = vi.fn()
    disconnect = vi.fn()
    unobserve = vi.fn()
}

Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    value: MockIntersectionObserver,
})

// Mock ResizeObserver
class MockResizeObserver {
    observe = vi.fn()
    disconnect = vi.fn()
    unobserve = vi.fn()
}

Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    value: MockResizeObserver,
})

// Mock IndexedDB (required by Dexie)
const mockIndexedDB = {
    open: vi.fn().mockReturnValue({
        onsuccess: null as any,
        onerror: null as any,
        onupgradeneeded: null as any,
        result: {
            createObjectStore: vi.fn().mockReturnValue({
                createIndex: vi.fn(),
            }),
            transaction: vi.fn().mockReturnValue({
                objectStore: vi.fn().mockReturnValue({
                    put: vi.fn(),
                    get: vi.fn(),
                    getAll: vi.fn().mockReturnValue({
                        onsuccess: null as any,
                        onerror: null as any,
                        result: [],
                    }),
                    delete: vi.fn(),
                    clear: vi.fn(),
                    update: vi.fn(),
                    toArray: vi.fn().mockResolvedValue([]),
                    where: vi.fn().mockReturnValue({
                        equals: vi.fn().mockReturnValue({
                            toArray: vi.fn().mockResolvedValue([]),
                            delete: vi.fn().mockResolvedValue(0),
                        }),
                    }),
                }),
                oncomplete: null as any,
                onerror: null as any,
            }),
            close: vi.fn(),
            objectStoreNames: {
                contains: vi.fn().mockReturnValue(true),
            },
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        setRequestHeader: vi.fn(),
    }),
    deleteDatabase: vi.fn(),
    cmp: vi.fn().mockReturnValue(0),
}

Object.defineProperty(window, 'indexedDB', {
    writable: true,
    value: mockIndexedDB,
})

// Mock IDBKeyRange
Object.defineProperty(window, 'IDBKeyRange', {
    writable: true,
    value: {
        only: vi.fn(),
        lowerBound: vi.fn(),
        upperBound: vi.fn(),
        bound: vi.fn(),
    },
})
