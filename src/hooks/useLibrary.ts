import { useState, useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import type { Slide } from '../types'

interface LibrarySlide extends Slide {
    savedAt: string
    category?: 'scripture' | 'song' | 'hymn' | 'custom' | 'sermon' | 'announcement'
}

const LIBRARY_STORAGE_KEY = 'presenta_library_slides'

export function useLibrary() {
    const [librarySlides, setLibrarySlides] = useState<LibrarySlide[]>(() => {
        try {
            const stored = localStorage.getItem(LIBRARY_STORAGE_KEY)
            return stored ? JSON.parse(stored) : []
        } catch {
            return []
        }
    })

    const activeSlides = useAppStore((state) => state.activeSlides)
    const appendActiveSlide = useAppStore((state) => state.appendActiveSlide)
    const appendActiveSlides = useAppStore((state) => state.appendActiveSlides)

    // Save to localStorage
    const persistLibrary = useCallback((slides: LibrarySlide[]) => {
        try {
            localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(slides))
        } catch (error) {
            console.error('Failed to save library to localStorage:', error)
        }
    }, [])

    // Add slide to library
    const addToLibrary = useCallback((slide: Slide, category?: LibrarySlide['category']) => {
        const librarySlide: LibrarySlide = {
            ...slide,
            id: `lib_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            savedAt: new Date().toISOString(),
            category: category || inferCategory(slide),
            saved: true,
        }

        setLibrarySlides((prev) => {
            const updated = [...prev, librarySlide]
            persistLibrary(updated)
            return updated
        })

        return librarySlide
    }, [persistLibrary])

    // Add multiple slides to library
    const addSlidesToLibrary = useCallback((slides: Slide[], category?: LibrarySlide['category']) => {
        const librarySlides: LibrarySlide[] = slides.map((slide) => ({
            ...slide,
            id: `lib_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            savedAt: new Date().toISOString(),
            category: category || inferCategory(slide),
            saved: true,
        }))

        setLibrarySlides((prev) => {
            const updated = [...prev, ...librarySlides]
            persistLibrary(updated)
            return updated
        })

        return librarySlides
    }, [persistLibrary])

    // Remove slide from library
    const removeFromLibrary = useCallback((slideId: string) => {
        setLibrarySlides((prev) => {
            const updated = prev.filter((s) => s.id !== slideId)
            persistLibrary(updated)
            return updated
        })
    }, [persistLibrary])

    // Clear all library slides
    const clearLibrary = useCallback(() => {
        setLibrarySlides([])
        localStorage.removeItem(LIBRARY_STORAGE_KEY)
    }, [])

    // Use library slide (add to active slides)
    const useSlide = useCallback((librarySlide: LibrarySlide, position?: number) => {
        const newSlide: Slide = {
            ...librarySlide,
            id: `slide_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            saved: false, // Reset saved flag when using
        }
        appendActiveSlide(newSlide, position)
        return newSlide
    }, [appendActiveSlide])

    // Use multiple library slides
    const useSlides = useCallback((libSlides: LibrarySlide[]) => {
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
        setLibrarySlides((prev) => {
            const updated = prev.map((s) =>
                s.id === slideId ? { ...s, ...updates } : s
            )
            persistLibrary(updated)
            return updated
        })
    }, [persistLibrary])

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
        useSlide,
        useSlides,
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
