import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConvexReactClient } from 'convex/react'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { ClerkProvider, SignedIn, SignedOut, useAuth } from '@clerk/clerk-react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import LiveView from './pages/LiveView'
import ChurchSetup from './pages/ChurchSetup'
import JoinChurch from './pages/JoinChurch'
import Landing from './pages/Landing'
import LoginPage from './pages/auth/Login'
import SignupPage from './pages/auth/Signup'
import TestPage from './pages/TestPage'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL!)
const queryClient = new QueryClient()

function AuthenticatedApp() {
  const hasChurch = useQuery(api.churches.hasChurch)

  if (hasChurch === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  if (!hasChurch) {
    return <ChurchSetup />
  }

  return <Dashboard />
}

// Wrapper component to handle redirect with current location
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

function App() {
  return (
    <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY!}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
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
                      <AuthenticatedApp />
                    </SignedIn>
                    <SignedOut>
                      <Navigate to="/landing" replace />
                    </SignedOut>
                  </>
                }
              />
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  )
}

export default App
