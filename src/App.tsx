import { useState, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ClerkProvider, SignedIn, SignedOut, useAuth } from '@clerk/clerk-react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import Dashboard from './pages/Dashboard'
import LiveView from './pages/LiveView'
import ChurchSetup from './pages/ChurchSetup'
import JoinChurch from './pages/JoinChurch'
import Landing from './pages/Landing'
import DesktopWelcome from './pages/DesktopWelcome'
import LoginPage from './pages/auth/Login'
import SignupPage from './pages/auth/Signup'
import TestPage from './pages/TestPage'
import { isDesktop } from './platform'
import { ConvexConnectionProvider, useConvexConnection } from './providers/ConvexConnectionProvider'
import { ConvexErrorBoundary } from './components/offline/ConvexErrorBoundary'
import { useAppStore } from './store/appStore'

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
                <Toaster position="top-right" />
            </>
        )
    }

    return (
        <>
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
            <Toaster position="top-right" />
        </>
    )
}

function App() {
    return (
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
    )
}

export default App