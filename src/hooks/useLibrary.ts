import { useCallback, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '../store/appStore'
import type { Slide } from '../types'

interface LibrarySlide extends Slide {
    savedAt: string
    category?: 'scripture' | 'song' | 'hymn' | 'custom' | 'sermon' | 'announcement'
}

const LIBRARY_STORAGE_KEY = 'selah_library_slides'

/**
 * The saved-slide library, held once for the whole app.
 *
 * It used to be `useState` in each of the three components that show it, each
 * seeded from localStorage and each persisting its own full copy — so saving a
 * slide from the preview was undone the next time the library panel wrote its
 * stale list, and the last writer won. Now there is one list; every component
 * reads it, and a change in another tab arrives through the `storage` event.
 */
function readStoredLibrary(): LibrarySlide[] {
    try {
        const stored = localStorage.getItem(LIBRARY_STORAGE_KEY)
        const parsed = stored ? JSON.parse(stored) : []
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}

let library: LibrarySlide[] = readStoredLibrary()
const listeners = new Set<() => void>()

function commit(next: LibrarySlide[]) {
    library = next
    try {
        localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(next))
    } catch (error) {
        // Usually the quota: slides can carry image backgrounds as data URLs.
        // This used to be a console message only, so the slide looked saved
        // and was gone after a reload.
        console.error('Failed to save library to localStorage:', error)
        toast.error("Couldn't save the library on this device — it's full. Remove some saved slides and try again.")
    }
    listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    const onStorage = (event: StorageEvent) => {
        if (event.key !== LIBRARY_STORAGE_KEY) return
        library = readStoredLibrary()
        listener()
    }
    window.addEventListener('storage', onStorage)
    return () => {
        listeners.delete(listener)
        window.removeEventListener('storage', onStorage)
    }
}

const getLibrary = () => library

function newLibraryId() {
    return `lib_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

export function useLibrary() {
    const librarySlides = useSyncExternalStore(subscribe, getLibrary, getLibrary)

    const appendActiveSlide = useAppStore((state) => state.appendActiveSlide)
    const appendActiveSlides = useAppStore((state) => state.appendActiveSlides)

    // Add slide to library
    const addToLibrary = useCallback((slide: Slide, category?: LibrarySlide['category']) => {
        const librarySlide: LibrarySlide = {
            ...slide,
            id: newLibraryId(),
            savedAt: new Date().toISOString(),
            category: category || inferCategory(slide),
            saved: true,
        }
        commit([...library, librarySlide])
        return librarySlide
    }, [])

    // Add multiple slides to library
    const addSlidesToLibrary = useCallback((slides: Slide[], category?: LibrarySlide['category']) => {
        const added: LibrarySlide[] = slides.map((slide) => ({
            ...slide,
            id: newLibraryId(),
            savedAt: new Date().toISOString(),
            category: category || inferCategory(slide),
            saved: true,
        }))
        commit([...library, ...added])
        return added
    }, [])

    // Remove slide from library
    const removeFromLibrary = useCallback((slideId: string) => {
        commit(library.filter((s) => s.id !== slideId))
    }, [])

    // Clear all library slides
    const clearLibrary = useCallback(() => {
        commit([])
    }, [])

    // Add a library slide to the active slides.
    //
    // Not named `useSlide`: it is a plain callback, not a React hook, and the
    // `use` prefix made every caller look like a conditional hook call to
    // react-hooks/rules-of-hooks.
    const addSlideToService = useCallback((librarySlide: LibrarySlide, position?: number) => {
        const newSlide: Slide = {
            ...librarySlide,
            id: `slide_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            saved: false, // Reset saved flag when using
        }
        appendActiveSlide(newSlide, position)
        return newSlide
    }, [appendActiveSlide])

    // The same, for several slides at once.
    const addSlidesToService = useCallback((libSlides: LibrarySlide[]) => {
        const newSlides: Slide[] = libSlides.map((slide) => ({
            ...slide,
            id: `slide_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            saved: false,
        }))
        appendActiveSlides(newSlides)
        return newSlides
    }, [appendActiveSlides])

    // Get slides by category
    const getSlidesByCategory = useCallback((category: LibrarySlide['category']) => {
        return librarySlides.filter((s) => s.category === category)
    }, [librarySlides])

    // Search library
    const searchLibrary = useCallback((query: string) => {
        const lowerQuery = query.toLowerCase()
        return librarySlides.filter((slide) =>
            slide.name.toLowerCase().includes(lowerQuery) ||
            slide.contents.some((c) => c.toLowerCase().includes(lowerQuery)) ||
            slide.title?.toLowerCase().includes(lowerQuery)
        )
    }, [librarySlides])

    // Update library slide
    const updateLibrarySlide = useCallback((slideId: string, updates: Partial<LibrarySlide>) => {
        commit(library.map((s) => (s.id === slideId ? { ...s, ...updates } : s)))
    }, [])

    // Check if slide is in library
    const isInLibrary = useCallback((slideId: string) => {
        return librarySlides.some((s) => s.id === slideId)
    }, [librarySlides])

    return {
        librarySlides,
        addToLibrary,
        addSlidesToLibrary,
        removeFromLibrary,
        clearLibrary,
        addSlideToService,
        addSlidesToService,
        getSlidesByCategory,
        searchLibrary,
        updateLibrarySlide,
        isInLibrary,
        libraryCount: librarySlides.length,
    }
}

// Helper to infer category from slide type
function inferCategory(slide: Slide): LibrarySlide['category'] {
    switch (slide.type) {
        case 'scripture':
        case 'bible':
            return 'scripture'
        case 'song':
            return 'song'
        case 'hymn':
            return 'hymn'
        case 'sermon':
            return 'sermon'
        case 'announcement':
            return 'announcement'
        default:
            return 'custom'
    }
}
