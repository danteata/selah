import { Suspense, lazy, useEffect, useState } from 'react'
import { ClerkProvider, SignedIn, SignedOut, useAuth } from '@clerk/clerk-react'
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { isDesktop } from './platform'
import { ConvexConnectionProvider, useConvexConnection } from './providers/ConvexConnectionProvider'
import { ConvexErrorBoundary } from './components/offline/ConvexErrorBoundary'
import { LicenseProvider } from './providers/LicenseProvider'
import { RouteErrorBoundary } from './components/offline/RouteErrorBoundary'
import { OutputErrorBoundary } from './components/offline/OutputErrorBoundary'
import { AnalyticsProvider, useAnalyticsContext } from './providers/AnalyticsProvider'
import type { AnalyticsProviderType as AnalyticsType } from './services/analytics/types'
import { AnalyticsEventType } from './services/analytics/types'
import { useAppStore } from './store/appStore'
import { useSongLibrarySync } from './hooks/useSongLibrarySync'
import { useOAuthCallback } from './hooks/useOAuthCallback'
import { useSyncCurrentUser } from './hooks/useSyncCurrentUser'
import { removeBundledNonSongs } from './services/songLibrary/bundledSongCleanup'
import { notifySongsChanged } from './hooks/useSongs'
import { applyThemeClass } from './utils/theme'
import { AppLoading } from './components/common/AppLoading'
// Lazy-load all route components so the initial JS chunk stays small.
// Each route's bundle is fetched only when the user navigates to it, which
// matters most on desktop where the operator hits Dashboard immediately but
// rarely opens /join/:code.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const LiveView = lazy(() => import('./pages/LiveView'))
const JoinChurch = lazy(() => import('./pages/JoinChurch'))
const Landing = lazy(() => import('./pages/Landing'))
const DesktopWelcome = lazy(() => import('./pages/DesktopWelcome'))
const LoginPage = lazy(() => import('./pages/auth/Login'))
const SignupPage = lazy(() => import('./pages/auth/Signup'))
const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPassword'))
const SsoCallback = lazy(() => import('./pages/auth/SsoCallback'))
const Downloads = lazy(() => import('./pages/Downloads'))
const BillingReturn = lazy(() => import('./pages/BillingReturn'))
// Desktop OAuth handoff routes. Both render only on the web build —
// on Tauri they fall through to the regular dashboard (see the
// `isDesktop()` guard inside each page). These are mounted at the
// root level so Vite's SPA fallback serves them even though they
// aren't in the main nav.
const DesktopOAuthCallback = lazy(() => import('./pages/auth/DesktopOAuthCallback'))
const DesktopOAuthDone = lazy(() => import('./pages/auth/DesktopOAuthDone'))

function RouteFallback() {
    return <AppLoading />
}

/**
 * The only place the `dark` class is written after boot.
 *
 * It used to watch `settings.isDarkMode`, which nothing ever assigned — so it
 * read `false` forever and this effect *removed* the class every time it ran.
 * On a fresh load Dashboard's own mount effect happened to put it back; on a
 * re-mount without that (an auth refresh after a network change, for one) the
 * app just went light. It now follows the store value the theme setters write.
 */
function useDarkModeSync() {
    const isDarkMode = useAppStore((s) => s.isDarkMode)
    useEffect(() => {
        applyThemeClass(isDarkMode)
    }, [isDarkMode])
}

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL!

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

/**
 * `/`: the studio for a signed-in operator, the welcome screen otherwise.
 *
 * One component whether or not Convex is reachable. There were two — one per
 * route tree — so connectivity changing swapped the component at `/` and
 * remounted Dashboard with everything open in it. Offline, the landing page
 * renders in place (the redirect to /landing is for the connected web app).
 *
 * `<SignedIn>`/`<SignedOut>` both render nothing until Clerk has loaded, and
 * the boot splash is gone by then, so this waits with a spinner instead.
 */
function Home() {
    const { isSignedIn, isLoaded } = useAuth()
    const { isOffline } = useConvexConnection()

    if (!isLoaded) return <AppLoading label="Signing you in" />
    if (isSignedIn) return <Dashboard />
    if (isDesktop()) return <DesktopWelcome />
    return isOffline ? <Landing /> : <Navigate to="/landing" replace />
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
    const { analytics } = useAnalyticsContext()
    const location = useLocation()
    useDarkModeSync()
    // The OAuth callback listener uses `useClerk()` (via
    // useOAuthCallback), so it has to run inside the <ClerkProvider>
    // tree. On web the hook is a no-op (no listener started) so it
    // doesn't affect the fly deployment.
    useOAuthCallback()
    useSyncCurrentUser()
    // Fetch the church's songs and upload ones saved on this device.
    useSongLibrarySync()

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
            app_version: __APP_VERSION__,
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

    // One route table whether or not Convex is reachable. There used to be two,
    // and switching between them on a connectivity change remounted the app.
    const sharedRoutes = (
        <>
            {/* The projector: fails to black and recovers by itself, never to
                the operator-facing error card nobody there can click. */}
            <Route path="/live" element={<OutputErrorBoundary><LiveView /></OutputErrorBoundary>} />
            <Route path="/landing" element={<RouteErrorBoundary name="landing"><Landing /></RouteErrorBoundary>} />
            <Route path="/login" element={<RouteErrorBoundary name="login"><LoginPage /></RouteErrorBoundary>} />
            <Route path="/signup" element={<RouteErrorBoundary name="signup"><SignupPage /></RouteErrorBoundary>} />
            <Route path="/forgot-password" element={<RouteErrorBoundary name="forgot-password"><ForgotPasswordPage /></RouteErrorBoundary>} />
            <Route path="/sso-callback" element={<RouteErrorBoundary name="sso-callback"><SsoCallback /></RouteErrorBoundary>} />
            <Route path="/join/:code" element={<RouteErrorBoundary name="join"><JoinChurchRoute /></RouteErrorBoundary>} />
            <Route path="/download" element={<RouteErrorBoundary name="download"><Downloads /></RouteErrorBoundary>} />
            <Route path="/billing/return" element={<RouteErrorBoundary name="billing-return"><BillingReturn /></RouteErrorBoundary>} />
            <Route path="/desktop-oauth-callback" element={<RouteErrorBoundary name="oauth-callback"><DesktopOAuthCallback /></RouteErrorBoundary>} />
            <Route path="/desktop-oauth-done" element={<RouteErrorBoundary name="oauth-done"><DesktopOAuthDone /></RouteErrorBoundary>} />
            {/* An unknown route used to render nothing at all — a blank page
                with only the toaster — e.g. after a navigate('/dashboard'). */}
            <Route path="*" element={<Navigate to="/" replace />} />
        </>
    )

    return (
        <>
            <Suspense fallback={<RouteFallback />}>
                <Routes>
                    {sharedRoutes}
                    <Route path="/" element={<RouteErrorBoundary name="home"><Home /></RouteErrorBoundary>} />
                </Routes>
            </Suspense>
            <Toaster position="top-right" />
        </>
    )
}

function App() {
    useEffect(() => {
        // The song library is no longer bundled. Installs that were seeded
        // with it get its non-song entries (another church's notes and
        // announcements) removed, once — see bundledSongCleanup.ts.
        if (!import.meta.env.DEV && !isDesktop()) return
        void removeBundledNonSongs().then((removed) => {
            if (removed > 0) {
                console.info(`[songs] Removed ${removed} bundled non-song entries from the library.`)
                notifySongsChanged()
            }
        })
    }, [])

    // Deep-link listener for Tauri OAuth callbacks is mounted inside
    // <AppRoutes /> below, which runs inside the <ClerkProvider>
    // tree. The hook calls `useClerk()` which requires that context,
    // so it can't run here at the App() root.

    return (
        <RouteErrorBoundary name="app-root">
            <AnalyticsProvider providerType={ANALYTICS_PROVIDER} apiKey={ANALYTICS_KEY}>
                <ClerkProvider
                    publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY!}
                    // On desktop, FORCE every post-auth redirect back into the
                    // app (`/`). Without this, the dev instance has no app
                    // redirect configured and Clerk sends the `tauri://`
                    // webview to its hosted Account Portal "Start building"
                    // page after the OAuth handshake. `force` overrides any
                    // redirect URL already baked into the flow (a `fallback`
                    // URL does not). Scoped to desktop so the web deployment's
                    // own redirect logic is untouched.
                    {...(isDesktop()
                        ? {
                              signInForceRedirectUrl: '/',
                              signUpForceRedirectUrl: '/',
                              afterSignOutUrl: '/',
                          }
                        : {})}
                >
                    <ConvexConnectionProvider convexUrl={CONVEX_URL}>
                        <ConvexErrorBoundary>
                            <LicenseProvider>
                                <HashRouter>
                                    <AppRoutes />
                                </HashRouter>
                            </LicenseProvider>
                        </ConvexErrorBoundary>
                    </ConvexConnectionProvider>
                </ClerkProvider>
            </AnalyticsProvider>
        </RouteErrorBoundary>
    )
}

export default App