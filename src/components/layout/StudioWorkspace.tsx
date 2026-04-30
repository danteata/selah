import { useEffect, useRef, useCallback } from 'react'
import { PreviewContent } from '../preview/PreviewContent'
import { LiveOutput } from '../live/LiveOutput'
import { useAppStore } from '../../store/appStore'

export function StudioWorkspace() {
    const slideQueueWidth = useAppStore((s) => s.slideQueueWidth)
    const setSlideQueueWidth = useAppStore((s) => s.setSlideQueueWidth)
    const isResizing = useRef(false)

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing.current) return
            const newWidth = Math.max(200, Math.min(500, e.clientX - 52))
            setSlideQueueWidth(newWidth)
        }
        const handleMouseUp = () => {
            if (!isResizing.current) return
            isResizing.current = false
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
        }
        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [setSlideQueueWidth])

    const startResize = useCallback(() => {
        isResizing.current = true
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
    }, [])

    return (
        <div className="studio-workspace-split">
            <div className="studio-slide-queue" style={{ width: slideQueueWidth }}>
                <PreviewContent />
            </div>

            <div
                onMouseDown={startResize}
                className="w-1.5 flex-shrink-0 cursor-col-resize hover:bg-[var(--accent-teal)]/20 transition-colors group relative"
            >
                <div className="absolute inset-y-0 -left-1 -right-1" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-8 bg-[var(--border-default)] group-hover:bg-[var(--accent-teal)] rounded-full transition-colors" />
            </div>

            <div className="studio-live-area">
                <LiveOutput />
            </div>
        </div>
    )
}