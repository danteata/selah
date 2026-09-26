import { useEffect, useRef } from 'react'
import { useConvexAuth, useMutation } from 'convex/react'
import { useUser } from '@clerk/clerk-react'
import { api } from '../../convex/_generated/api'

/**
 * Make sure the signed-in person has a user row, once Convex holds their token.
 *
 * The sign-in screens call `upsertUser` the moment Clerk's session activates,
 * which can beat Convex attaching the token. The server now resolves the caller
 * from that token rather than trusting the ids it is sent, so such an early
 * call is a quiet no-op — and this is what makes the row land regardless of
 * which way the race went. Runs once per Clerk user per page load.
 */
export function useSyncCurrentUser() {
    const { isAuthenticated } = useConvexAuth()
    const { user } = useUser()
    const upsertUser = useMutation(api.users.upsertUser)
    const syncedFor = useRef<string | null>(null)

    useEffect(() => {
        if (!isAuthenticated || !user || syncedFor.current === user.id) return
        syncedFor.current = user.id

        const email = user.primaryEmailAddress?.emailAddress ?? ''
        upsertUser({
            fullname: user.fullName || email.split('@')[0] || 'User',
        }).catch((err) => {
            // Allow a retry on the next render rather than giving up for the
            // whole session over one dropped request.
            syncedFor.current = null
            console.warn('[useSyncCurrentUser] failed to sync user row:', err)
        })
    }, [isAuthenticated, user, upsertUser])
}
