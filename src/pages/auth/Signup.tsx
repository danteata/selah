import { useState, useMemo } from 'react'
import { useSignUp, useUser } from '@clerk/clerk-react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Eye, EyeOff, Mail, Lock, User, Church, ArrowRight, Cloud, Check, Users } from 'lucide-react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'

type SignupStep = 'account' | 'church' | 'verify'

export default function SignupPage() {
    const { signUp, isLoaded, setActive } = useSignUp()
    const navigate = useNavigate()
    const location = useLocation()

    // Convex mutations
    const createChurch = useMutation(api.churches.createChurch)
    const joinChurch = useMutation(api.churches.joinChurch)
    const upsertUser = useMutation(api.users.upsertUser)

    // Get redirect path from location state (for invite links)
    const from = (location.state as { from?: string })?.from

    // Extract invite code from the redirect path
    const inviteCode = useMemo(() => {
        if (from?.startsWith('/join/')) {
            return from.replace('/join/', '')
        }
        return null
    }, [from])

    // Fetch invitation details if we have an invite code
    const invitationData = useQuery(
        api.invitations.getInvitationByCode,
        inviteCode ? { code: inviteCode } : 'skip'
    )

    const [step, setStep] = useState<SignupStep>('account')
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState('')

    // Account info
    const [fullName, setFullName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)

    // Church info
    const [churchOption, setChurchOption] = useState<'create' | 'join'>('create')
    const [churchName, setChurchName] = useState('')
    const [churchCode, setChurchCode] = useState('')

    // Verification
    const [verificationCode, setVerificationCode] = useState('')

    const handleAccountSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!isLoaded) return

        setIsLoading(true)
        setError('')

        try {
            await signUp.create({
                emailAddress: email,
                password,
                firstName: fullName.split(' ')[0],
                lastName: fullName.split(' ').slice(1).join(' '),
            })

            // Send email verification
            await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
            setStep('verify')
        } catch (err: any) {
            console.error('Sign up error:', err)
            setError(err.errors?.[0]?.message || 'Failed to create account.')
        } finally {
            setIsLoading(false)
        }
    }

    const handleVerification = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!isLoaded) return

        setIsLoading(true)
        setError('')

        try {
            const result = await signUp.attemptEmailAddressVerification({
                code: verificationCode,
            })

            if (result.status === 'complete' && result.createdSessionId) {
                await setActive({ session: result.createdSessionId })
                // Create user record in Convex
                await upsertUser({
                    clerkId: result.createdSessionId,
                    fullname: fullName,
                    email,
                })
                // If in invite flow, go directly to the join page to accept
                // Otherwise continue to church setup
                if (isInviteFlow && from) {
                    navigate(from)
                } else {
                    setStep('church')
                }
            }
        } catch (err: any) {
            console.error('Verification error:', err)
            setError(err.errors?.[0]?.message || 'Invalid verification code.')
        } finally {
            setIsLoading(false)
        }
    }

    const handleChurchSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)
        setError('')

        try {
            if (churchOption === 'create') {
                // Create new church in Convex
                await createChurch({
                    name: churchName,
                    type: 'church',
                })
                // Redirect to the original destination (invite link) or home
                navigate(from || '/')
            } else {
                // Join existing church
                await joinChurch({ inviteCode: churchCode })
                // Redirect to the original destination (invite link) or home
                navigate(from || '/')
            }
        } catch (err: any) {
            console.error('Church setup error:', err)
            setError(err.message || 'Failed to set up church.')
        } finally {
            setIsLoading(false)
        }
    }

    const handleGoogleSignUp = async () => {
        if (!isLoaded) return

        try {
            await signUp.authenticateWithRedirect({
                strategy: 'oauth_google',
                redirectUrl: '/sso-callback',
                redirectUrlComplete: from || '/',
            })
        } catch (err: any) {
            console.error('Google sign up error:', err)
            setError('Failed to sign up with Google.')
        }
    }

    // Determine if we're in invite flow
    const isInviteFlow = inviteCode && invitationData?.isValid && invitationData?.church
    const invitedChurch = invitationData?.church

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-primary-100 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 p-4">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-primary-500 to-primary-700 rounded-2xl shadow-lg shadow-primary-500/30 mb-4">
                        <Cloud className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                        {step === 'account' && (isInviteFlow ? 'Join the team' : 'Create your account')}
                        {step === 'verify' && 'Verify your email'}
                        {step === 'church' && 'Set up your church'}
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 mt-1">
                        {step === 'account' && (isInviteFlow
                            ? `Create your account to join ${invitedChurch?.name}'s media team`
                            : 'Start your journey with Selah')}
                        {step === 'verify' && 'Enter the code we sent to your email'}
                        {step === 'church' && 'Create a new church or join an existing one'}
                    </p>
                </div>

                {/* Invitation Banner - only show on account step when there's a valid invite */}
                {step === 'account' && isInviteFlow && invitedChurch && (
                    <div className="mb-6 p-4 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-xl">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-primary-100 dark:bg-primary-800/30 rounded-xl flex items-center justify-center">
                                <Users className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                            </div>
                            <div>
                                <p className="font-medium text-gray-900 dark:text-white">
                                    You're invited to join
                                </p>
                                <p className="text-sm text-primary-600 dark:text-primary-400 font-semibold">
                                    {invitedChurch.name}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Progress Steps - hide church step if in invite flow */}
                <div className="flex items-center justify-center gap-2 mb-6">
                    {['account', 'verify', 'church'].filter(s => !isInviteFlow || s !== 'church').map((s, i) => (
                        <div key={s} className="flex items-center gap-2">
                            <div
                                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${step === s
                                    ? 'bg-blue-600 text-white'
                                    : ['account', 'verify', 'church'].indexOf(step) > i
                                        ? 'bg-green-500 text-white'
                                        : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                                    }`}
                            >
                                {['account', 'verify', 'church'].indexOf(step) > i ? (
                                    <Check className="w-4 h-4" />
                                ) : (
                                    i + 1
                                )}
                            </div>
                            {i < (isInviteFlow ? 1 : 2) && (
                                <div
                                    className={`w-12 h-0.5 ${['account', 'verify', 'church'].indexOf(step) > i
                                        ? 'bg-green-500'
                                        : 'bg-gray-200 dark:bg-gray-700'
                                        }`}
                                />
                            )}
                        </div>
                    ))}
                </div>

                {/* Form Card */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl shadow-gray-200/50 dark:shadow-none border border-gray-200 dark:border-gray-800 p-6">
                    {/* Error Message */}
                    {error && (
                        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
                            {error}
                        </div>
                    )}

                    {/* Account Step */}
                    {step === 'account' && (
                        <>
                            <button
                                onClick={handleGoogleSignUp}
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

                            <form onSubmit={handleAccountSubmit} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Full Name
                                    </label>
                                    <div className="relative">
                                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                        <input
                                            type="text"
                                            value={fullName}
                                            onChange={(e) => setFullName(e.target.value)}
                                            placeholder="John Doe"
                                            required
                                            className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                        />
                                    </div>
                                </div>

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
                                            placeholder="Min. 8 characters"
                                            required
                                            minLength={8}
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

                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-xl font-medium hover:from-primary-700 hover:to-primary-800 focus:ring-4 focus:ring-primary-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                >
                                    {isLoading ? (
                                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <>
                                            Create Account
                                            <ArrowRight className="w-4 h-4" />
                                        </>
                                    )}
                                </button>
                            </form>
                        </>
                    )}

                    {/* Verification Step */}
                    {step === 'verify' && (
                        <form onSubmit={handleVerification} className="space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400 text-center mb-4">
                                We sent a 6-digit code to <strong>{email}</strong>
                            </p>

                            <div>
                                <input
                                    type="text"
                                    value={verificationCode}
                                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    placeholder="Enter 6-digit code"
                                    required
                                    className="w-full px-4 py-3 text-center text-2xl tracking-widest border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 font-mono focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading || verificationCode.length < 6}
                                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-xl font-medium hover:from-primary-700 hover:to-primary-800 focus:ring-4 focus:ring-primary-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                {isLoading ? (
                                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <>
                                        Verify Email
                                        <ArrowRight className="w-4 h-4" />
                                    </>
                                )}
                            </button>

                            <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                                Didn't receive the code?{' '}
                                <button type="button" className="text-primary-600 hover:text-primary-700">
                                    Resend
                                </button>
                            </p>
                        </form>
                    )}

                    {/* Church Step */}
                    {step === 'church' && (
                        <form onSubmit={handleChurchSubmit} className="space-y-4">
                            <div className="flex gap-2 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
                                <button
                                    type="button"
                                    onClick={() => setChurchOption('create')}
                                    className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${churchOption === 'create'
                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow'
                                        : 'text-gray-600 dark:text-gray-400'
                                        }`}
                                >
                                    Create Church
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setChurchOption('join')}
                                    className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${churchOption === 'join'
                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow'
                                        : 'text-gray-600 dark:text-gray-400'
                                        }`}
                                >
                                    Join Church
                                </button>
                            </div>

                            {churchOption === 'create' ? (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Church Name
                                    </label>
                                    <div className="relative">
                                        <Church className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                        <input
                                            type="text"
                                            value={churchName}
                                            onChange={(e) => setChurchName(e.target.value)}
                                            placeholder="Grace Community Church"
                                            required
                                            className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Church Invite Code
                                    </label>
                                    <input
                                        type="text"
                                        value={churchCode}
                                        onChange={(e) => setChurchCode(e.target.value.toUpperCase())}
                                        placeholder="ABC-123-XYZ"
                                        required
                                        className="w-full px-4 py-3 text-center uppercase tracking-widest border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                    />
                                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 text-center">
                                        Get this code from your church administrator
                                    </p>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-xl font-medium hover:from-primary-700 hover:to-primary-800 focus:ring-4 focus:ring-primary-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                {isLoading ? (
                                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <>
                                        {churchOption === 'create' ? 'Create Church' : 'Join Church'}
                                        <ArrowRight className="w-4 h-4" />
                                    </>
                                )}
                            </button>

                            <button
                                type="button"
                                onClick={() => navigate('/')}
                                className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                            >
                                Skip for now
                            </button>
                        </form>
                    )}
                </div>

                {/* Sign In Link */}
                {step === 'account' && (
                    <p className="text-center mt-6 text-gray-600 dark:text-gray-400">
                        Already have an account?{' '}
                        <Link to="/login" state={from ? { from } : undefined} className="text-primary-600 hover:text-primary-700 font-medium">
                            Sign in
                        </Link>
                    </p>
                )}
            </div>
        </div>
    )
}
