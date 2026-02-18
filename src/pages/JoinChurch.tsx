import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { Church, Check, X, Loader2, Users, ArrowRight } from 'lucide-react'

export default function JoinChurch() {
    const { code } = useParams<{ code: string }>()
    const navigate = useNavigate()
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState('')

    // Get invitation details
    const invitationData = useQuery(
        api.invitations.getInvitationByCode,
        code ? { code } : 'skip'
    )

    // Accept invitation mutation
    const acceptInvitation = useMutation(api.invitations.acceptInvitation)

    const handleAccept = async () => {
        if (!code) return

        setIsLoading(true)
        setError('')

        try {
            const result = await acceptInvitation({ code })
            // Redirect to dashboard on success
            navigate('/')
        } catch (err: any) {
            setError(err.message || 'Failed to accept invitation')
        } finally {
            setIsLoading(false)
        }
    }

    // Loading state
    if (invitationData === undefined) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-primary-100 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
                <div className="text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-primary-600 mx-auto mb-4" />
                    <p className="text-gray-600 dark:text-gray-400">Loading invitation...</p>
                </div>
            </div>
        )
    }

    // Invalid invitation
    if (!invitationData || !invitationData.isValid) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-primary-100 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 p-4">
                <div className="w-full max-w-md text-center">
                    <div className="w-16 h-16 mx-auto mb-6 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                        <X className="w-8 h-8 text-red-600 dark:text-red-400" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                        Invalid Invitation
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 mb-6">
                        {invitationData?.invitation?.status === 'accepted'
                            ? 'This invitation has already been accepted.'
                            : invitationData?.invitation?.status === 'revoked'
                                ? 'This invitation has been revoked by the church administrator.'
                                : invitationData?.invitation?.status === 'expired'
                                    ? 'This invitation has expired. Please request a new invitation.'
                                    : 'The invitation code you provided is invalid or has expired.'}
                    </p>
                    <Link
                        to="/"
                        className="inline-flex items-center gap-2 px-6 py-3 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 transition-colors"
                    >
                        Go to Home
                        <ArrowRight className="w-4 h-4" />
                    </Link>
                </div>
            </div>
        )
    }

    const { invitation, church } = invitationData

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-primary-100 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 p-4">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-primary-500 to-primary-700 rounded-2xl shadow-lg shadow-primary-500/30 mb-4">
                        <Church className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                        You're Invited!
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 mt-1">
                        Join {church.name}'s media team on Selah
                    </p>
                </div>

                {/* Invitation Card */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl shadow-gray-200/50 dark:shadow-none border border-gray-200 dark:border-gray-800 p-6">
                    {/* Church Info */}
                    <div className="text-center mb-6">
                        <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-primary-100 to-primary-200 dark:from-primary-900/30 dark:to-primary-800/30 rounded-2xl flex items-center justify-center">
                            <Users className="w-10 h-10 text-primary-600 dark:text-primary-400" />
                        </div>
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                            {church.name}
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 capitalize">
                            {church.type}
                        </p>
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
                            {error}
                        </div>
                    )}

                    {/* Invitation Details */}
                    <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl">
                        <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
                            <Check className="w-5 h-5 text-green-500" />
                            <span>Access to songs, slides, and schedules</span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400 mt-2">
                            <Check className="w-5 h-5 text-green-500" />
                            <span>Collaborate with team members in real-time</span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400 mt-2">
                            <Check className="w-5 h-5 text-green-500" />
                            <span>AI-powered sermon listener features</span>
                        </div>
                    </div>

                    {/* Expiration Notice */}
                    {invitation.expiresAt && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 text-center mb-4">
                            This invitation expires on {new Date(invitation.expiresAt).toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                            })}
                        </p>
                    )}

                    {/* Accept Button */}
                    <button
                        onClick={handleAccept}
                        disabled={isLoading}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-xl font-medium hover:from-primary-700 hover:to-primary-800 focus:ring-4 focus:ring-primary-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Accepting...
                            </>
                        ) : (
                            <>
                                Accept Invitation
                                <ArrowRight className="w-4 h-4" />
                            </>
                        )}
                    </button>

                    {/* Decline Link */}
                    <Link
                        to="/"
                        className="block text-center mt-4 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                        Decline and go back
                    </Link>
                </div>
            </div>
        </div>
    )
}