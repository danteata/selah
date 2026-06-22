import { Suspense, lazy, useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ClerkProvider, SignedIn, SignedOut, useAuth } from '@clerk/clerk-react'
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { isDesktop } from './platform'
import { ConvexConnectionProvider, useConvexConnection } from './providers/ConvexConnectionProvider'
import { ConvexErrorBoundary } from './components/offline/ConvexErrorBoundary'
import { RouteErrorBoundary } from './components/offline/RouteErrorBoundary'
import { AnalyticsProvider, useAnalyticsContext } from './providers/AnalyticsProvider'
import type { AnalyticsProviderType as AnalyticsType } from './services/analytics/types'
import { AnalyticsEventType } from './services/analytics/types'
import { useAppStore } from './store/appStore'
import { useOAuthCallback } from './hooks/useOAuthCallback'
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
// Lazy-load all route components so the initial JS chunk stays small.
// Each route's bundle is fetched only when the user navigates to it, which
// matters most on desktop where the operator hits Dashboard immediately but
// rarely opens /test or /join/:code.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const LiveView = lazy(() => import('./pages/LiveView'))
const JoinChurch = lazy(() => import('./pages/JoinChurch'))
const Landing = lazy(() => import('./pages/Landing'))
const DesktopWelcome = lazy(() => import('./pages/DesktopWelcome'))
const LoginPage = lazy(() => import('./pages/auth/Login'))
const SignupPage = lazy(() => import('./pages/auth/Signup'))
const TestPage = lazy(() => import('./pages/TestPage'))
const Downloads = lazy(() => import('./pages/Downloads'))
// Desktop OAuth handoff routes. Both render only on the web build —
// on Tauri they fall through to the regular dashboard (see the
// `isDesktop()` guard inside each page). These are mounted at the
// root level so Vite's SPA fallback serves them even though they
// aren't in the main nav.
const DesktopOAuthCallback = lazy(() => import('./pages/auth/DesktopOAuthCallback'))
const DesktopOAuthDone = lazy(() => import('./pages/auth/DesktopOAuthDone'))

function RouteFallback() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
    )
}

function useDarkModeSync() {
    const isDarkMode = useAppStore((s) => s.settings.isDarkMode)
    useEffect(() => {
        if (isDarkMode) {
            document.documentElement.classList.add('dark')
        } else {
            document.documentElement.classList.remove('dark')
        }
    }, [isDarkMode])
}

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL!
const queryClient = new QueryClient()

// Analytics configuration from environment variables.
// Set VITE_ANALYTICS_PROVIDER to "posthog", "amplitude", "console", or "none".
// In development, defaults to "console" so events are visible in the browser dev tools.
const ANALYTICS_PROVIDER: AnalyticsType =
    (import.meta.env.VITE_ANALYTICS_PROVIDER as AnalyticsType) || (import.meta.env.DEV ? 'console' : 'none')
const ANALYTICS_KEY =
    ANALYTICS_PROVIDER === 'posthog'
        ? import.meta.env.VITE_POSTHOG_KEY ?? ''
        : ANALYTICS_PROVIDER === 'amplitude'
            ? import.meta.env.VITE_AMPLITUDE_KEY ?? ''
            : '' // console / none don't need a real key

function OfflineApp() {
    const { isSignedIn, isLoaded } = useAuth()

    if (!isLoaded) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
                <div className="text-center">
                    <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-gray-600 dark:text-gray-400">Loading...</p>
                </div>
            </div>
        )
    }

    if (isSignedIn) {
        return <Dashboard />
    }

    if (isDesktop()) {
        return <DesktopWelcome />
    }

    return <Landing />
}

function JoinChurchRoute() {
    const location = useLocation()
    return (
        <>
            <SignedIn>
                <JoinChurch />
            </SignedIn>
            <SignedOut>
                <Navigate to="/signup" replace state={{ from: location.pathname }} />
            </SignedOut>
        </>
    )
}

function AppRoutes() {
    const { isOffline } = useConvexConnection()
    const { analytics } = useAnalyticsContext()
    const location = useLocation()
    useDarkModeSync()
    // The OAuth callback listener uses `useClerk()` (via
    // useOAuthCallback), so it has to run inside the <ClerkProvider>
    // tree. On web the hook is a no-op (no listener started) so it
    // doesn't affect the fly deployment.
    useOAuthCallback()

    // Desktop OAuth callback handling.
    //
    // After the system browser completes Google OAuth, the Rust
    // listener navigates the webview to `/?<clerk-params>` (root
    // path = `index.html`, the only path Tauri v2's asset server
    // serves reliably — it has no SPA fallback). The React app
    // re-mounts here and we render `<DesktopOAuthCallback />` while
    // the Clerk SDK exchanges the callback params for a session in
    // the webview's own client.
    //
    // We latch on mount when any known Clerk callback param is
    // present (the handshake architecture uses `__clerk_handshake`;
    // older/ticket flows use `rotating_token_nonce` /
    // `__clerk_ticket`). Crucially we DON'T latch forever: once
    // Clerk reports `isSignedIn`, we strip the params from the URL
    // and release the latch so the normal routes (Dashboard) take
    // over. Without this, Clerk silently consuming the handshake
    // param would leave the user stuck on the spinner.
    const { isSignedIn } = useAuth()
    const [oauthPending, setOauthPending] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false
        const params = new URLSearchParams(window.location.search)
        return (
            params.has('__clerk_handshake') ||
            params.has('__clerk_ticket') ||
            params.has('rotating_token_nonce')
        )
    })
    useEffect(() => {
        if (!oauthPending) return
        if (isSignedIn) {
            // Drop the callback params without a reload, then release
            // the latch so the router renders the dashboard.
            window.history.replaceState(
                {},
                '',
                window.location.pathname + window.location.hash,
            )
            setOauthPending(false)
        }
    }, [oauthPending, isSignedIn])

    // App lifecycle: fire APP_INITIALIZED once + PAGE_VIEWED on every route change
    useEffect(() => {
        const start = Date.now()
        analytics.trackEvent(AnalyticsEventType.APP_INITIALIZED, {
            is_desktop: isDesktop(),
            app_version: '0.1.0',
        })
        analytics.trackEvent(AnalyticsEventType.APP_LOADED, {
            load_ms: Date.now() - start,
            is_desktop: isDesktop(),
        })
        // SESSION_START fires on first route mount — covers both web and
        // desktop cold starts without needing auth state.
        analytics.trackEvent(AnalyticsEventType.SESSION_START, {
            is_desktop: isDesktop(),
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        analytics.page(location.pathname)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname])

    // OAuth callback landing screen. Shown only while the callback
    // params are present AND the session hasn't been established
    // yet. The effect above releases this latch on `isSignedIn`.
    if (oauthPending && !isSignedIn) {
        return (
            <RouteErrorBoundary name="oauth-callback">
                <DesktopOAuthCallback />
            </RouteErrorBoundary>
        )
    }

    if (isOffline) {
        return (
            <>
                <Suspense fallback={<RouteFallback />}>
                    <Routes>
                        <Route path="/live" element={<RouteErrorBoundary name="live"><LiveView /></RouteErrorBoundary>} />
                        <Route path="/landing" element={<RouteErrorBoundary name="landing"><Landing /></RouteErrorBoundary>} />
                        <Route path="/login" element={<RouteErrorBoundary name="login"><LoginPage /></RouteErrorBoundary>} />
                        <Route path="/signup" element={<RouteErrorBoundary name="signup"><SignupPage /></RouteErrorBoundary>} />
                        <Route path="/test" element={<RouteErrorBoundary name="test"><TestPage /></RouteErrorBoundary>} />
                        <Route path="/join/:code" element={<RouteErrorBoundary name="join"><JoinChurchRoute /></RouteErrorBoundary>} />
                        <Route path="/download" element={<RouteErrorBoundary name="download"><Downloads /></RouteErrorBoundary>} />
                        <Route path="/desktop-oauth-callback" element={<RouteErrorBoundary name="oauth-callback"><DesktopOAuthCallback /></RouteErrorBoundary>} />
                        <Route path="/desktop-oauth-done" element={<RouteErrorBoundary name="oauth-done"><DesktopOAuthDone /></RouteErrorBoundary>} />
                        <Route
                            path="/"
                            element={<RouteErrorBoundary name="home"><OfflineApp /></RouteErrorBoundary>}
                        />
                    </Routes>
                </Suspense>
                <Toaster position="top-right" />
            </>
        )
    }

    return (
        <>
            <Suspense fallback={<RouteFallback />}>
                <Routes>
                    <Route path="/live" element={<RouteErrorBoundary name="live"><LiveView /></RouteErrorBoundary>} />
                    <Route path="/landing" element={<RouteErrorBoundary name="landing"><Landing /></RouteErrorBoundary>} />
                    <Route path="/login" element={<RouteErrorBoundary name="login"><LoginPage /></RouteErrorBoundary>} />
                    <Route path="/signup" element={<RouteErrorBoundary name="signup"><SignupPage /></RouteErrorBoundary>} />
                    <Route path="/test" element={<RouteErrorBoundary name="test"><TestPage /></RouteErrorBoundary>} />
                    <Route path="/join/:code" element={<RouteErrorBoundary name="join"><JoinChurchRoute /></RouteErrorBoundary>} />
                    <Route path="/download" element={<RouteErrorBoundary name="download"><Downloads /></RouteErrorBoundary>} />
                    <Route path="/desktop-oauth-callback" element={<RouteErrorBoundary name="oauth-callback"><DesktopOAuthCallback /></RouteErrorBoundary>} />
                    <Route path="/desktop-oauth-done" element={<RouteErrorBoundary name="oauth-done"><DesktopOAuthDone /></RouteErrorBoundary>} />
                    <Route
                        path="/"
                        element={
                            <RouteErrorBoundary name="dashboard">
                                <>
                                    <SignedIn>
                                        <Dashboard />
                                    </SignedIn>
                                    <SignedOut>
                                        {isDesktop() ? <DesktopWelcome /> : <Navigate to="/landing" replace />}
                                    </SignedOut>
                                </>
                            </RouteErrorBoundary>
                        }
                    />
                </Routes>
            </Suspense>
            <Toaster position="top-right" />
        </>
    )
}

function App() {
    const [version, setVersion] = useState('')
    const [checking, setChecking] = useState(false)
    const [status, setStatus] = useState('')
    const { analytics } = useAnalyticsContext()

    useEffect(() => {
        // Tauri APIs throw synchronously in the web build because
        // window.__TAURI_INTERNALS__ is undefined. Only fetch the version
        // when we're actually running inside Tauri.
        if (!isDesktop()) return
        getVersion().then(setVersion).catch(() => {
            // Silently ignore — version is informational only
        })
    }, [])

    // Deep-link listener for Tauri OAuth callbacks is mounted inside
    // <AppRoutes /> below, which runs inside the <ClerkProvider>
    // tree. The hook calls `useClerk()` which requires that context,
    // so it can't run here at the App() root.

    async function check() {
        if (!isDesktop()) {
            setStatus('updates are only available in the desktop app')
            return
        }
        setChecking(true)
        setStatus('checking...')
        const start = Date.now()
        analytics.trackEvent(AnalyticsEventType.DESKTOP_UPDATE_CHECKED)
        try {
            const r = await invoke<string>('check_update')
            setStatus(r)
            if (r && !r.toLowerCase().includes('up to date') && !r.toLowerCase().includes('no update')) {
                analytics.trackEvent(AnalyticsEventType.DESKTOP_UPDATE_INSTALLED, {
                    elapsed_ms: Date.now() - start,
                })
            }
        } catch (e) {
            setStatus(`error: ${e}`)
        } finally {
            setChecking(false)
        }
    }

    return (
        <RouteErrorBoundary name="app-root">
            <AnalyticsProvider providerType={ANALYTICS_PROVIDER} apiKey={ANALYTICS_KEY}>
                <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY!}>
                    <ConvexConnectionProvider convexUrl={CONVEX_URL}>
                        <ConvexErrorBoundary>
                            <QueryClientProvider client={queryClient}>
                                <HashRouter>
                                    <AppRoutes />
                                </HashRouter>
                            </QueryClientProvider>
                        </ConvexErrorBoundary>
                    </ConvexConnectionProvider>
                </ClerkProvider>
            </AnalyticsProvider>
        </RouteErrorBoundary>
    )
}

export default App