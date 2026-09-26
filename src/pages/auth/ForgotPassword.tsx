import { useState } from 'react'
import { useSignIn } from '@clerk/clerk-react'
import { Link, useNavigate } from 'react-router-dom'
import { Mail, ArrowRight, Cloud, ArrowLeft, KeyRound, Lock } from 'lucide-react'

type Step = 'email' | 'reset'

const inputClass =
    'w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent'

function clerkMessage(err: unknown, fallback: string): string {
    const entry = (err as { errors?: Array<{ longMessage?: string; message?: string }> })?.errors?.[0]
    return entry?.longMessage || entry?.message || fallback
}

/**
 * Password reset by emailed code.
 *
 * Clerk's `reset_password_email_code` sends a six-digit code, not a link. This
 * page used to stop after sending it — telling the user to follow a link that
 * never arrived, with nowhere to enter the code — so a reset could never be
 * finished. Step two takes the code and the new password and signs them in.
 */
export default function ForgotPasswordPage() {
    const { signIn, setActive, isLoaded } = useSignIn()
    const navigate = useNavigate()

    const [step, setStep] = useState<Step>('email')
    const [email, setEmail] = useState('')
    const [code, setCode] = useState('')
    const [password, setPassword] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState('')

    const sendCode = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!isLoaded) return

        setIsLoading(true)
        setError('')
        try {
            await signIn.create({
                strategy: 'reset_password_email_code',
                identifier: email.trim(),
            })
            setStep('reset')
        } catch (err) {
            setError(clerkMessage(err, 'Failed to send the reset code.'))
        } finally {
            setIsLoading(false)
        }
    }

    const resetPassword = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!isLoaded) return

        setIsLoading(true)
        setError('')
        try {
            const result = await signIn.attemptFirstFactor({
                strategy: 'reset_password_email_code',
                code: code.trim(),
                password,
            })
            if (result.status === 'complete') {
                await setActive({ session: result.createdSessionId })
                navigate('/')
            } else {
                // e.g. a second factor is required — the sign-in page handles those.
                setError('Password changed. Please sign in to finish.')
            }
        } catch (err) {
            setError(clerkMessage(err, 'That code is incorrect or has expired.'))
        } finally {
            setIsLoading(false)
        }
    }

    const submitButton = (label: string) => (
        <button
            type="submit"
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-xl font-medium hover:from-primary-700 hover:to-primary-800 focus:ring-4 focus:ring-primary-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
            {isLoading ? (
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
                <>
                    {label}
                    <ArrowRight className="w-4 h-4" />
                </>
            )}
        </button>
    )

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-primary-100 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 p-4">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-primary-500 to-primary-700 rounded-2xl shadow-lg shadow-primary-500/30 mb-4">
                        <Cloud className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                        {step === 'reset' ? 'Choose a new password' : 'Reset your password'}
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 mt-1">
                        {step === 'reset'
                            ? <>We emailed a code to <strong>{email}</strong></>
                            : 'Enter your email and we\'ll send you a reset code'}
                    </p>
                </div>

                {/* Form Card */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl shadow-gray-200/50 dark:shadow-none border border-gray-200 dark:border-gray-800 p-6">
                    {error && (
                        <div role="alert" className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
                            {error}
                        </div>
                    )}

                    {step === 'email' ? (
                        <form onSubmit={sendCode} className="space-y-4">
                            <div>
                                <label htmlFor="reset-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Email
                                </label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                    <input
                                        id="reset-email"
                                        type="email"
                                        autoComplete="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="you@church.com"
                                        required
                                        className={inputClass}
                                    />
                                </div>
                            </div>
                            {submitButton('Send Reset Code')}
                        </form>
                    ) : (
                        <form onSubmit={resetPassword} className="space-y-4">
                            <div>
                                <label htmlFor="reset-code" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Code from the email
                                </label>
                                <div className="relative">
                                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                    <input
                                        id="reset-code"
                                        inputMode="numeric"
                                        autoComplete="one-time-code"
                                        value={code}
                                        onChange={(e) => setCode(e.target.value)}
                                        placeholder="123456"
                                        required
                                        className={inputClass}
                                    />
                                </div>
                            </div>
                            <div>
                                <label htmlFor="reset-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    New password
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                    <input
                                        id="reset-password"
                                        type="password"
                                        autoComplete="new-password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        minLength={8}
                                        required
                                        className={inputClass}
                                    />
                                </div>
                            </div>
                            {submitButton('Reset Password')}
                            <button
                                type="button"
                                onClick={() => { setStep('email'); setCode(''); setError('') }}
                                className="w-full text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                            >
                                Use a different email or resend the code
                            </button>
                        </form>
                    )}
                </div>

                <p className="text-center mt-6">
                    <Link
                        to="/login"
                        className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to login
                    </Link>
                </p>
            </div>
        </div>
    )
}
