import { Suspense, lazy, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ClerkProvider, SignedIn, SignedOut, useAuth } from '@clerk/clerk-react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { isDesktop } from './platform'
import { ConvexConnectionProvider, useConvexConnection } from './providers/ConvexConnectionProvider'
import { ConvexErrorBoundary } from './components/offline/ConvexErrorBoundary'
import { RouteErrorBoundary } from './components/offline/RouteErrorBoundary'
import { useAppStore } from './store/appStore'

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

    if (isOffline) {
        return (
            <>
                <Suspense fallback={<RouteFallback />}>
                    <Routes>
                        <Route path="/live" element={<LiveView />} />
                        <Route path="/landing" element={<Landing />} />
                        <Route path="/login" element={<LoginPage />} />
                        <Route path="/signup" element={<SignupPage />} />
                        <Route path="/test" element={<TestPage />} />
                        <Route path="/join/:code" element={<JoinChurchRoute />} />
                        <Route
                            path="/"
                            element={<OfflineApp />}
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
                    <Route path="/live" element={<LiveView />} />
                    <Route path="/landing" element={<Landing />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/signup" element={<SignupPage />} />
                    <Route path="/test" element={<TestPage />} />
                    <Route path="/join/:code" element={<JoinChurchRoute />} />
                    <Route
                        path="/"
                        element={
                            <>
                                <SignedIn>
                                    <Dashboard />
                                </SignedIn>
                                <SignedOut>
                                    {isDesktop() ? <DesktopWelcome /> : <Navigate to="/landing" replace />}
                                </SignedOut>
                            </>
                        }
                    />
                </Routes>
            </Suspense>
            <Toaster position="top-right" />
        </>
    )
}

function App() {
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