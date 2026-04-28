import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const savedTheme = localStorage.getItem('theme')
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches

if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
    document.documentElement.classList.add('dark')
} else {
    document.documentElement.classList.remove('dark')
}

function isConvexError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    const msg = error.message || ''
    return (
        msg.includes('exceeded the free plan') ||
        msg.includes('deployments have been disabled') ||
        (msg.includes('CONVEX') && msg.includes('Server Error'))
    )
}

const originalReportError = window.reportError?.bind(window)
window.reportError = function (error: any, ...args: any[]) {
    if (isConvexError(error)) {
        console.warn('[Suppressed Convex Error]:', (error as Error).message?.substring(0, 100))
        return
    }
    if (originalReportError) {
        return originalReportError(error, ...args)
    }
}

window.addEventListener('error', (event: ErrorEvent) => {
    if (isConvexError(event.error)) {
        console.warn('[Suppressed Convex Error (event)]:', event.error.message?.substring(0, 100))
        event.preventDefault()
        event.stopImmediatePropagation()
        return
    }
}, true)

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    if (isConvexError(event.reason)) {
        console.warn('[Suppressed Convex Error (promise)]:', event.reason?.message?.substring(0, 100))
        event.preventDefault()
    }
})

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
)