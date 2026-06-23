import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Church, ArrowRight, WifiOff } from 'lucide-react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'
import { useAnalytics } from '../hooks'
import { AnalyticsEventType, sanitizeAuthError } from '../services/analytics/types'

type ChurchSetupStep = 'create' | 'join'

export default function ChurchSetup() {
    const navigate = useNavigate()
    const { isOffline } = useConvexConnection()
    const { trackPage, trackEvent } = useAnalytics()

    const createChurch = useMutation(api.churches.createChurch)
    const joinChurch = useMutation(api.churches.joinChurch)

    const [step, setStep] = useState<ChurchSetupStep>('create')
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState('')

    const [churchName, setChurchName] = useState('')
    const [churchCode, setChurchCode] = useState('')

    // Track page view on mount
    useEffect(() => {
        trackPage('/church-setup')
    }, [trackPage])

    if (isOffline) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-primary-100 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 p-4">
                <div className="w-full max-w-md text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-2xl mb-6">
                        <WifiOff className="w-8 h-8 text-amber-600 dark:text-amber-400" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                        You're offline
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 mb-6">
                        Setting up a church requires an internet connection. Please check your connection and try again.
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-6 py-3 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 transition-colors"
                    >
                        Retry Connection
                    </button>
                </div>
            </div>
        )
    }

    const handleChurchSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)
        setError('')

        try {
            if (step === 'create') {
                // Create new church in Convex
                await createChurch({
                    name: churchName,
                    type: 'church',
                })
                trackEvent(AnalyticsEventType.CHURCH_CREATED)
                navigate('/')
            } else {
                // Join existing church
                await joinChurch({ inviteCode: churchCode })
                trackEvent(AnalyticsEventType.CHURCH_JOINED)
                navigate('/')
            }
        } catch (err: any) {
            console.error('Church setup error:', err)
            setError(err.message || 'Failed to set up church.')
            trackEvent(AnalyticsEventType.AUTH_FAILED, { method: 'church_setup', error_category: sanitizeAuthError(err.message || '') })
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-primary-100 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 p-4">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-primary-500 to-primary-700 rounded-2xl shadow-lg shadow-primary-500/30 mb-4">
                        <Church className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                        Set up your church
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 mt-1">
                        Create a new church or join an existing one to get started
                    </p>
                </div>

                {/* Form Card */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl shadow-gray-200/50 dark:shadow-none border border-gray-200 dark:border-gray-800 p-6">
                    {/* Error Message */}
                    {error && (
                        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleChurchSubmit} className="space-y-4">
                        <div className="flex gap-2 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
                            <button
                                type="button"
                                onClick={() => setStep('create')}
                                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${step === 'create'
                                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow'
                                    : 'text-gray-600 dark:text-gray-400'
                                    }`}
                            >
                                Create Church
                            </button>
                            <button
                                type="button"
                                onClick={() => setStep('join')}
                                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${step === 'join'
                                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow'
                                    : 'text-gray-600 dark:text-gray-400'
                                    }`}
                            >
                                Join Church
                            </button>
                        </div>

                        {step === 'create' ? (
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
                                    {step === 'create' ? 'Create Church' : 'Join Church'}
                                    <ArrowRight className="w-4 h-4" />
                                </>
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    )
}
