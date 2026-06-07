import { useState } from 'react'
import { useSignIn, useSignUp, useClerk } from '@clerk/clerk-react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'

export type AuthMode = 'signin' | 'signup'

export function useClerkAuth(mode: AuthMode) {
    const { signIn, isLoaded: signInLoaded } = useSignIn()
    const { signUp, isLoaded: signUpLoaded } = useSignUp()
    const { setActive } = useClerk()

    const upsertUser = useMutation(api.users.upsertUser)
    const createChurch = useMutation(api.churches.createChurch)
    const joinChurch = useMutation(api.churches.joinChurch)

    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState('')

    const isLoaded = mode === 'signin' ? signInLoaded : signUpLoaded

    const handleEmailSignIn = async (email: string, password: string) => {
        if (!signIn || !isLoaded) return false
        setIsLoading(true)
        setError('')
        try {
            const result = await signIn.create({ identifier: email, password })
            if (result.status === 'complete' && result.createdSessionId) {
                await setActive({ session: result.createdSessionId })
                await upsertUser({ clerkId: result.createdSessionId, fullname: email.split('@')[0], email })
                return true
            }
            return false
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to sign in. Please check your credentials.'
            setError((err as { errors?: Array<{ message?: string }> }).errors?.[0]?.message || message)
            return false
        } finally {
            setIsLoading(false)
        }
    }

    const handleGoogleSignIn = async (redirectUrl?: string) => {
        if (!signIn || !isLoaded) return
        try {
            // Web uses the same-origin path. Tauri desktop uses
            // the fly.io round-trip via /desktop-oauth-done.
            const isDesktop = typeof window !== 'undefined' && '__TAURI__' in window
            const callbackUrl = isDesktop
                ? 'https://selah.fly.dev/desktop-oauth-callback'
                : `${window.location.origin}/sso-callback`
            const callbackComplete = isDesktop
                ? 'https://selah.fly.dev/desktop-oauth-done'
                : redirectUrl || '/'
            await signIn.authenticateWithRedirect({
                strategy: 'oauth_google',
                redirectUrl: callbackUrl,
                redirectUrlComplete: callbackComplete,
            })
        } catch {
            setError('Failed to sign in with Google.')
        }
    }

    const handleEmailSignUp = async (fullName: string, email: string, password: string) => {
        if (!signUp || !isLoaded) return null
        setIsLoading(true)
        setError('')
        try {
            await signUp.create({
                emailAddress: email,
                password,
                firstName: fullName.split(' ')[0],
                lastName: fullName.split(' ').slice(1).join(' '),
            })
            await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
            return 'verify'
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to create account.'
            setError((err as { errors?: Array<{ message?: string }> }).errors?.[0]?.message || message)
            return null
        } finally {
            setIsLoading(false)
        }
    }

    const handleGoogleSignUp = async (redirectUrl?: string) => {
        if (!signUp || !isLoaded) return
        try {
            const isDesktop = typeof window !== 'undefined' && '__TAURI__' in window
            const callbackUrl = isDesktop
                ? 'https://selah.fly.dev/desktop-oauth-callback'
                : `${window.location.origin}/sso-callback`
            const callbackComplete = isDesktop
                ? 'https://selah.fly.dev/desktop-oauth-done'
                : redirectUrl || '/'
            await signUp.authenticateWithRedirect({
                strategy: 'oauth_google',
                redirectUrl: callbackUrl,
                redirectUrlComplete: callbackComplete,
            })
        } catch {
            setError('Failed to sign up with Google.')
        }
    }

    const handleVerification = async (code: string) => {
        if (!signUp || !isLoaded) return null
        setIsLoading(true)
        setError('')
        try {
            const result = await signUp.attemptEmailAddressVerification({ code })
            if (result.status === 'complete' && result.createdSessionId) {
                await setActive({ session: result.createdSessionId })
                return result.createdSessionId
            }
            return null
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Invalid verification code.'
            setError((err as { errors?: Array<{ message?: string }> }).errors?.[0]?.message || message)
            return null
        } finally {
            setIsLoading(false)
        }
    }

    const handleCreateUser = async (clerkId: string, fullname: string, email: string) => {
        await upsertUser({ clerkId, fullname, email })
    }

    const handleCreateChurch = async (name: string) => {
        await createChurch({ name, type: 'church' })
    }

    const handleJoinChurch = async (inviteCode: string) => {
        await joinChurch({ inviteCode })
    }

    const clearError = () => setError('')

    return {
        isLoaded,
        isLoading,
        error,
        clearError,
        handleEmailSignIn,
        handleGoogleSignIn,
        handleEmailSignUp,
        handleGoogleSignUp,
        handleVerification,
        handleCreateUser,
        handleCreateChurch,
        handleJoinChurch,
    }
}