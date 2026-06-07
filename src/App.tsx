import { Suspense, lazy, useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ClerkProvider, SignedIn, SignedOut, useAuth } from '@clerk/clerk-react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { isDesktop } from './platform'
import { ConvexConnectionProvider, useConvexConnection } from './providers/ConvexConnectionProvider'
import { ConvexErrorBoundary } from './components/offline/ConvexErrorBoundary'
import { RouteErrorBoundary } from './components/offline/RouteErrorBoundary'
import { useAppStore } from './store/appStore'
import { useOAuthCallback } from './hooks/useOAuthCallback'
import { useDeepLinkOAuth } from './hooks/useDeepLinkOAuth'
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
    useDarkModeSync()
    // The OAuth callback listener uses `useClerk()` (via
    // useOAuthCallback), so it has to run inside the <ClerkProvider>
    // tree. On web the hook is a no-op (no listener started) so it
    // doesn't affect the fly deployment.
    useOAuthCallback()

    // The deep-link hook listens for `selah://...` URLs the OS hands
    // to the desktop app after the browser OAuth completes. On web
    // it's a no-op (no Tauri runtime).
    useDeepLinkOAuth()

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
        try {
            const r = await invoke<string>('check_update')
            setStatus(r)
        } catch (e) {
            setStatus(`error: ${e}`)
        } finally {
            setChecking(false)
        }
    }

    return (
        <RouteErrorBoundary name="app-root">
            <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY!}>
                <ConvexConnectionProvider convexUrl={CONVEX_URL}>
                    <ConvexErrorBoundary>
                        <QueryClientProvider client={queryClient}>
                            <BrowserRouter>
                                <AppRoutes />
                            </BrowserRouter>
                        </QueryClientProvider>
                    </ConvexErrorBoundary>
                </ConvexConnectionProvider>
            </ClerkProvider>
        </RouteErrorBoundary>
    )
}

export default App