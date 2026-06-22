import { useState, useEffect } from 'react'
import { useSignIn, useUser } from '@clerk/clerk-react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Eye, EyeOff, Mail, Lock, ArrowRight, Cloud } from 'lucide-react'
import { useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useAnalytics } from '../../hooks'
import { AnalyticsEventType, sanitizeAuthError } from '../../services/analytics/types'
import { isDesktop } from '../../platform'

export default function LoginPage() {
    const { signIn, isLoaded, setActive } = useSignIn()
    const navigate = useNavigate()
    const location = useLocation()
    const { trackEvent, trackPage } = useAnalytics()

    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState('')

    // Convex mutation to create user
    const upsertUser = useMutation(api.users.upsertUser)

    // Get redirect path from location state (for invite links)
    const from = (location.state as { from?: string })?.from

    // Track page view on mount
    useEffect(() => {
        trackPage('/login')
    }, [trackPage])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!isLoaded) return

        setIsLoading(true)
        setError('')
        trackEvent(AnalyticsEventType.AUTH_ATTEMPTED, { method: 'email', page: 'login' })

        try {
            const result = await signIn.create({
                identifier: email,
                password,
            })

            if (result.status === 'complete' && result.createdSessionId) {
                await setActive({ session: result.createdSessionId })
                trackEvent(AnalyticsEventType.USER_SIGNED_IN, { method: 'email' })
                // Create user record in Convex if it doesn't exist
                // We'll try to extract user info from Clerk or use the provided email
                await upsertUser({
                    clerkId: result.createdSessionId,
                    fullname: email.split('@')[0], // Use email username as fallback
                    email,
                })
                // Redirect to the original destination (invite link) or dashboard
                navigate(from || '/dashboard')
            } else {
                console.log('Sign in needs additional steps:', result)
            }
        } catch (err: any) {
            console.error('Sign in error:', err)
            const errorMessage = err.errors?.[0]?.message || 'Failed to sign in. Please check your credentials.'
            setError(errorMessage)
            trackEvent(AnalyticsEventType.AUTH_FAILED, { method: 'email', error_category: sanitizeAuthError(errorMessage) })
        } finally {
            setIsLoading(false)
        }
    }

    const handleGoogleSignIn = async () => {
        if (!isLoaded) return
        trackEvent(AnalyticsEventType.AUTH_GOOGLE_CLICKED, { page: 'login' })
        setError('')

        try {
            // Clerk's API enforces that the redirect URL be
            // `http` or `https` (rejects `tauri://` and any
            // other custom scheme with `invalid_url_scheme`).
            // The Tauri webview's own origin is `tauri://` —
            // not acceptable to Clerk. We use the Rust-side
            // localhost listener (oauth_listener.rs) as the
            // redirect target: it's `http://`, the dev
            // instance's wildcard allowlist accepts it, and the
            // Rust side then navigates the Tauri webview back
            // to the Tauri-served root path with the OAuth
            // query string preserved. `App.tsx` reads the query
            // string and renders `<DesktopOAuthCallback />`
            // directly to process the handshake.
            //
            // Why this works in the Tauri webview: Clerk's
            // `signIn.authenticateWithRedirect` doesn't
            // navigate the system browser (it just does a
            // hard `window.location.assign` to the OAuth URL).
            // The Tauri webview follows the navigation, the
            // Clerk hosted sign-in loads inside the webview,
            // and the resulting redirects to the listener URL
            // also stay inside the webview. The Rust side
            // takes over the final hop back to the React app.
            const callbackUrl = isDesktop()
                ? 'http://localhost:19888/oauth-callback'
                : `${window.location.origin}/sso-callback`
            const callbackComplete = isDesktop()
                ? 'http://localhost:19888/oauth-callback' // unused on Tauri; the Rust listener navigates
                : from || '/'
            await signIn.authenticateWithRedirect({
                strategy: 'oauth_google',
                redirectUrl: callbackUrl,
                redirectUrlComplete: callbackComplete,
            })
        } catch (err: any) {
            console.error('[auth] Google sign in error:', err)
            setError('Failed to sign in with Google.')
            trackEvent(AnalyticsEventType.AUTH_FAILED, { method: 'google', error_category: 'oauth_redirect_failed' })
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-primary-100 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 p-4">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-primary-500 to-primary-700 rounded-2xl shadow-lg shadow-primary-500/30 mb-4">
                        <Cloud className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                        Welcome back
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 mt-1">
                        Sign in to Selah
                    </p>
                </div>

                {/* Form Card */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl shadow-gray-200/50 dark:shadow-none border border-gray-200 dark:border-gray-800 p-6">
                    {/* Google Sign In */}
                    <button
                        onClick={handleGoogleSignIn}
                        className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                        </svg>
                        Continue with Google
                    </button>

                    <div className="relative my-6">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-gray-200 dark:border-gray-700" />
                        </div>
                        <div className="relative flex justify-center text-sm">
                            <span className="px-2 bg-white dark:bg-gray-900 text-gray-500">or</span>
                        </div>
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
                            {error}
                        </div>
                    )}

                    {/* Email/Password Form */}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Email
                            </label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="you@church.com"
                                    required
                                    className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Password
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    required
                                    className="w-full pl-10 pr-12 py-3 border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                >
                                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                />
                                <span className="text-sm text-gray-600 dark:text-gray-400">Remember me</span>
                            </label>
                            <Link
                                to="/forgot-password"
                                className="text-sm text-primary-600 hover:text-primary-700"
                            >
                                Forgot password?
                            </Link>
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-xl font-medium hover:from-primary-700 hover:to-primary-800 focus:ring-4 focus:ring-primary-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            {isLoading ? (
                                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <>
                                    Sign In
                                    <ArrowRight className="w-4 h-4" />
                                </>
                            )}
                        </button>
                    </form>
                </div>

                {/* Sign Up Link */}
                <p className="text-center mt-6 text-gray-600 dark:text-gray-400">
                    Don't have an account?{' '}
                    <Link to="/signup" state={from ? { from } : undefined} className="text-primary-600 hover:text-primary-700 font-medium">
                        Sign up free
                    </Link>
                </p>
            </div>
        </div>
    )
}
