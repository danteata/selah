import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import {
    Users,
    Link2,
    Mail,
    Copy,
    Check,
    Clock,
    MoreVertical,
    RefreshCw,
    Trash2,
    UserPlus,
    X,
    Loader2,
} from 'lucide-react'
import { useAnalytics } from '../../hooks/useAnalytics'
import { AnalyticsEventType } from '../../services/analytics/types'
import type { Id } from '../../../convex/_generated/dataModel'
import { useEntitlements } from '../../providers/LicenseProvider'
import { toast } from 'sonner'

/**
 * Pro team-size cap, for upgrade copy only. The server (convex/entitlements.ts
 * PLAN_LIMITS) is the source of truth that actually enforces it; this mirror
 * exists just so the free-plan prompt can name the number without importing
 * server code into the client bundle.
 */
const PRO_TEAM_LIMIT = 5

interface TeamManagementPanelProps {
    churchId: string
    isAdmin: boolean
}

export function TeamManagementPanel({ churchId, isAdmin }: TeamManagementPanelProps) {
    const [activeTab, setActiveTab] = useState<'members' | 'invitations'>('members')
    const [showInviteModal, setShowInviteModal] = useState(false)

    const teamMembers = useQuery(api.invitations.getTeamMembers, { churchId })
    const invitations = useQuery(api.invitations.getInvitations, { churchId })
    // Authoritative plan + team-size cap from the server (single source of truth
    // for the "free = solo, Pro = up to 5" model — never drifts from enforcement).
    const billing = useQuery(api.paystack.getMyChurchBilling)
    const { trackEvent } = useAnalytics()
    const { startProCheckout } = useEntitlements()
    const seenMemberIdsRef = useRef<Set<string>>(new Set())
    const hasInitializedMembersRef = useRef(false)

    const plan = billing?.plan ?? 'free'
    const maxTeamMembers = billing?.maxTeamMembers ?? 1
    // Prefer the server's projection (members + pending email invites); fall
    // back to a client estimate before the billing query resolves.
    const clientPending = invitations?.filter((i) => i.status === 'pending' && i.type === 'email').length ?? 0
    const teamSize = billing
        ? billing.memberCount + billing.pendingInvites
        : (teamMembers?.length ?? 0) + clientPending
    const atCap = billing ? !billing.canAddMember : teamSize >= maxTeamMembers
    const overCap = billing?.overCap ?? false

    const handleInviteClick = () => {
        if (atCap) {
            toast.warning(
                plan === 'pro'
                    ? `You've reached your Pro plan limit of ${maxTeamMembers} team members.`
                    : 'Team collaboration is a Pro feature.',
                {
                    description:
                        plan === 'pro'
                            ? 'Remove a member to free up a seat, or contact us about a larger plan.'
                            : `Upgrade to Selah Pro to invite your team (up to ${PRO_TEAM_LIMIT} members).`,
                    duration: 10000,
                    action:
                        plan === 'pro'
                            ? undefined
                            : { label: 'Upgrade', onClick: () => void startProCheckout() },
                },
            )
            return
        }
        setShowInviteModal(true)
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                        Team Management
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Manage your church's media team members and invitations
                    </p>
                </div>
                {isAdmin && (
                    <button
                        onClick={handleInviteClick}
                        className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                    >
                        <UserPlus className="w-4 h-4" />
                        Invite Member
                        {plan === 'free' && atCap && (
                            <span className="ml-1 rounded bg-amber-400 px-1 py-0.5 text-[9px] font-semibold uppercase leading-none text-amber-950">
                                Pro
                            </span>
                        )}
                    </button>
                )}
            </div>

            {/* Over-cap warning: the team is larger than the current plan allows
                (e.g. a Pro church that lapsed to Free). Existing members are kept,
                but no new ones can be added until the plan is restored/upgraded. */}
            {overCap && (
                <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                        Your team has {billing?.memberCount} members but the{' '}
                        {plan === 'pro' ? 'Pro' : 'Free'} plan allows {maxTeamMembers}.
                        {plan === 'pro'
                            ? ' Remove members to get back within the limit.'
                            : ' Team collaboration is paused — resubscribe to Pro to restore it.'}
                    </span>
                    {isAdmin && plan === 'free' && (
                        <button
                            onClick={() => void startProCheckout()}
                            className="shrink-0 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
                        >
                            Resubscribe to Pro
                        </button>
                    )}
                </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit">
                <button
                    onClick={() => setActiveTab('members')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'members'
                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                        }`}
                >
                    <Users className="w-4 h-4" />
                    Members ({teamMembers?.length || 0})
                </button>
                <button
                    onClick={() => setActiveTab('invitations')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'invitations'
                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                        }`}
                >
                    <Mail className="w-4 h-4" />
                    Invitations ({invitations?.filter(i => i.status === 'pending').length || 0})
                </button>
            </div>

            {/* Content */}
            {activeTab === 'members' ? (
                <MembersList members={teamMembers || []} />
            ) : (
                <InvitationsList
                    invitations={invitations || []}
                    churchId={churchId}
                    isAdmin={isAdmin}
                />
            )}

            {/* Invite Modal */}
            {showInviteModal && (
                <InviteModal
                    churchId={churchId}
                    onClose={() => setShowInviteModal(false)}
                />
            )}
        </div>
    )
}

// Members List Component
function MembersList({ members }: { members: any[] }) {
    const { trackEvent } = useAnalytics()
    const seenMemberIdsRef = useRef<Set<string>>(new Set())
    const hasInitializedRef = useRef(false)

    // Detect new members joining the team (skip the initial load)
    useEffect(() => {
        if (!members || members.length === 0) {
            hasInitializedRef.current = true
            return
        }
        if (!hasInitializedRef.current) {
            // First non-empty load — mark all as seen, no events
            members.forEach((m) => seenMemberIdsRef.current.add(String(m._id)))
            hasInitializedRef.current = true
            return
        }
        for (const m of members) {
            const id = String(m._id)
            if (!seenMemberIdsRef.current.has(id)) {
                seenMemberIdsRef.current.add(id)
                trackEvent(AnalyticsEventType.TEAM_MEMBER_JOINED, {
                    member_id: id,
                    role: m.role,
                })
            }
        }
    }, [members, trackEvent])

    const getRoleBadge = (role: string) => {
        const styles: Record<string, string> = {
            superadmin: 'bg-gray-100 text-gray-700 dark:bg-gray-700/30 dark:text-gray-300',
            admin: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
            member: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
        }
        return styles[role] || styles.member
    }

    if (members.length === 0) {
        return (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No team members yet</p>
            </div>
        )
    }

    return (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Member
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Role
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Joined
                        </th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {members.map((member) => (
                        <tr key={member._id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                            <td className="px-4 py-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white text-sm font-medium">
                                        {member.fullname?.charAt(0).toUpperCase() || member.email?.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <div className="font-medium text-gray-900 dark:text-white">
                                            {member.fullname}
                                        </div>
                                        <div className="text-sm text-gray-500 dark:text-gray-400">
                                            {member.email}
                                        </div>
                                    </div>
                                </div>
                            </td>
                            <td className="px-4 py-3">
                                <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getRoleBadge(member.role)}`}>
                                    {member.role}
                                </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                                {member.createdAt ? new Date(member.createdAt).toLocaleDateString() : '-'}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

// Invitations List Component
function InvitationsList({
    invitations,
    churchId,
    isAdmin,
}: {
    invitations: any[]
    churchId: string
    isAdmin: boolean
}) {
    const [menuOpen, setMenuOpen] = useState<string | null>(null)
    const revokeInvitation = useMutation(api.invitations.revokeInvitation)
    const regenerateCode = useMutation(api.invitations.regenerateInviteCode)
    const [copiedCode, setCopiedCode] = useState<string | null>(null)

    const handleCopy = async (code: string) => {
        const url = `${window.location.origin}/join/${code}`
        await navigator.clipboard.writeText(url)
        setCopiedCode(code)
        setTimeout(() => setCopiedCode(null), 2000)
    }

    const handleRevoke = async (invitationId: string) => {
        if (confirm('Are you sure you want to revoke this invitation?')) {
            await revokeInvitation({ invitationId })
        }
    }

    const handleRegenerate = async (invitationId: string) => {
        if (confirm('This will generate a new invite link. The old link will no longer work.')) {
            await regenerateCode({ invitationId })
        }
    }

    const getStatusBadge = (status: string) => {
        const styles: Record<string, string> = {
            pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
            accepted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
            revoked: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
            expired: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
        }
        return styles[status] || styles.pending
    }

    const pendingInvitations = invitations.filter(i => i.status === 'pending')
    const pastInvitations = invitations.filter(i => i.status !== 'pending')

    if (invitations.length === 0) {
        return (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                <Mail className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No invitations yet</p>
                {isAdmin && (
                    <p className="text-sm mt-2">
                        Invite team members to help manage your church's presentations
                    </p>
                )}
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Pending Invitations */}
            {pendingInvitations.length > 0 && (
                <div>
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                        Pending Invitations
                    </h3>
                    <div className="space-y-2">
                        {pendingInvitations.map((invitation) => (
                            <div
                                key={invitation._id}
                                className="flex items-center justify-between p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700"
                            >
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
                                        {invitation.type === 'email' ? (
                                            <Mail className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
                                        ) : (
                                            <Link2 className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
                                        )}
                                    </div>
                                    <div>
                                        <div className="font-medium text-gray-900 dark:text-white">
                                            {invitation.type === 'email' ? invitation.email : 'Invite Link'}
                                        </div>
                                        <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
                                            {invitation.expiresAt && (
                                                <>
                                                    <Clock className="w-3 h-3" />
                                                    Expires {new Date(invitation.expiresAt).toLocaleDateString()}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleCopy(invitation.code)}
                                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                                    >
                                        {copiedCode === invitation.code ? (
                                            <>
                                                <Check className="w-4 h-4 text-green-500" />
                                                Copied
                                            </>
                                        ) : (
                                            <>
                                                <Copy className="w-4 h-4" />
                                                Copy Link
                                            </>
                                        )}
                                    </button>
                                    {isAdmin && (
                                        <div className="relative">
                                            <button
                                                onClick={() => setMenuOpen(menuOpen === invitation._id ? null : invitation._id)}
                                                className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                                            >
                                                <MoreVertical className="w-4 h-4" />
                                            </button>
                                            {menuOpen === invitation._id && (
                                                <div className="absolute right-0 mt-1 w-40 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-10">
                                                    <button
                                                        onClick={() => {
                                                            handleRegenerate(invitation._id)
                                                            setMenuOpen(null)
                                                        }}
                                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                                                    >
                                                        <RefreshCw className="w-4 h-4" />
                                                        Regenerate
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            handleRevoke(invitation._id)
                                                            setMenuOpen(null)
                                                        }}
                                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                        Revoke
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Past Invitations */}
            {pastInvitations.length > 0 && (
                <div>
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                        Past Invitations
                    </h3>
                    <div className="space-y-2">
                        {pastInvitations.map((invitation) => (
                            <div
                                key={invitation._id}
                                className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 opacity-75"
                            >
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                                        {invitation.type === 'email' ? (
                                            <Mail className="w-5 h-5 text-gray-400" />
                                        ) : (
                                            <Link2 className="w-5 h-5 text-gray-400" />
                                        )}
                                    </div>
                                    <div>
                                        <div className="font-medium text-gray-700 dark:text-gray-300">
                                            {invitation.type === 'email' ? invitation.email : 'Invite Link'}
                                        </div>
                                        <div className="text-sm text-gray-500 dark:text-gray-400">
                                            {invitation.acceptedAt
                                                ? `Accepted ${new Date(invitation.acceptedAt).toLocaleDateString()}`
                                                : invitation.status.charAt(0).toUpperCase() + invitation.status.slice(1)}
                                        </div>
                                    </div>
                                </div>
                                <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(invitation.status)}`}>
                                    {invitation.status}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

// Invite Modal Component
function InviteModal({ churchId, onClose }: { churchId: string; onClose: () => void }) {
    const [inviteType, setInviteType] = useState<'link' | 'email'>('link')
    const [email, setEmail] = useState('')
    const [message, setMessage] = useState('')
    const [expiresInDays, setExpiresInDays] = useState(7)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState<{ code: string; url: string; email?: string } | null>(null)
    const [copied, setCopied] = useState(false)

    const createInviteLink = useMutation(api.invitations.createInviteLink)
    const sendEmailInvitation = useMutation(api.invitations.sendEmailInvitation)
    const { trackEvent } = useAnalytics()

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)
        setError('')
        setSuccess(null)

        try {
            if (inviteType === 'link') {
                const result = await createInviteLink({
                    churchId,
                    expiresInDays: expiresInDays || undefined,
                    message: message || undefined,
                })
                trackEvent(AnalyticsEventType.TEAM_INVITATION_SENT, {
                    method: 'link',
                    expires_in_days: expiresInDays || 0,
                })
                setSuccess({
                    code: result.code,
                    url: result.inviteUrl,
                })
            } else {
                if (!email.trim()) {
                    throw new Error('Please enter an email address')
                }
                const result = await sendEmailInvitation({
                    churchId,
                    email: email.trim(),
                    message: message || undefined,
                    expiresInDays,
                })

                trackEvent(AnalyticsEventType.TEAM_INVITATION_SENT, {
                    method: 'email',
                    expires_in_days: expiresInDays,
                })

                // Send the email via HTTP action
                const response = await fetch('/api/emails/sendInviteEmail', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        to: result.email,
                        churchName: result.churchName,
                        inviterName: result.inviterName,
                        inviteUrl: result.inviteUrl,
                        message: message || undefined,
                        expiresAt: result.expiresAt,
                    }),
                })

                if (!response.ok) {
                    console.error('Failed to send email, but invitation was created')
                }

                setSuccess({
                    code: result.code,
                    url: result.inviteUrl,
                    email: result.email,
                })
            }
        } catch (err: any) {
            setError(err.message || 'Failed to create invitation')
        } finally {
            setIsLoading(false)
        }
    }

    const handleCopy = async () => {
        if (success) {
            await navigator.clipboard.writeText(success.url)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                        Invite Team Member
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4">
                    {success ? (
                        <div className="text-center py-4">
                            <div className="w-12 h-12 mx-auto mb-4 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                                <Check className="w-6 h-6 text-green-600 dark:text-green-400" />
                            </div>
                            <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                                {inviteType === 'email' ? 'Invitation Sent!' : 'Invite Link Created!'}
                            </h4>
                            {inviteType === 'email' && success.email && (
                                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                                    An invitation has been sent to {success.email}
                                </p>
                            )}
                            <div className="flex items-center gap-2 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg mb-4">
                                <input
                                    type="text"
                                    value={success.url}
                                    readOnly
                                    className="flex-1 bg-transparent text-sm text-gray-700 dark:text-gray-300 outline-none"
                                />
                                <button
                                    onClick={handleCopy}
                                    className="flex items-center gap-1 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                                >
                                    {copied ? (
                                        <>
                                            <Check className="w-4 h-4" />
                                            Copied
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="w-4 h-4" />
                                            Copy
                                        </>
                                    )}
                                </button>
                            </div>
                            <button
                                onClick={onClose}
                                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                            >
                                Done
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {/* Error */}
                            {error && (
                                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
                                    {error}
                                </div>
                            )}

                            {/* Invite Type Toggle */}
                            <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
                                <button
                                    type="button"
                                    onClick={() => setInviteType('link')}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${inviteType === 'link'
                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow'
                                        : 'text-gray-600 dark:text-gray-400'
                                        }`}
                                >
                                    <Link2 className="w-4 h-4" />
                                    Share Link
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setInviteType('email')}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${inviteType === 'email'
                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow'
                                        : 'text-gray-600 dark:text-gray-400'
                                        }`}
                                >
                                    <Mail className="w-4 h-4" />
                                    Send Email
                                </button>
                            </div>

                            {/* Email Input (for email type) */}
                            {inviteType === 'email' && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Email Address
                                    </label>
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="colleague@church.com"
                                        required
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                    />
                                </div>
                            )}

                            {/* Expiration */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Expires After
                                </label>
                                <select
                                    value={expiresInDays}
                                    onChange={(e) => setExpiresInDays(Number(e.target.value))}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                >
                                    <option value={7}>7 days</option>
                                    <option value={14}>14 days</option>
                                    <option value={30}>30 days</option>
                                    <option value={0}>Never</option>
                                </select>
                            </div>

                            {/* Personal Message */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Personal Message (optional)
                                </label>
                                <textarea
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    placeholder="Join our media team at Grace Community Church!"
                                    rows={2}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                                />
                            </div>

                            {/* Submit Button */}
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Creating...
                                    </>
                                ) : inviteType === 'email' ? (
                                    <>
                                        <Mail className="w-4 h-4" />
                                        Send Invitation
                                    </>
                                ) : (
                                    <>
                                        <Link2 className="w-4 h-4" />
                                        Generate Link
                                    </>
                                )}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    )
}

export default TeamManagementPanel