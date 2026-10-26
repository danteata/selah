import { describe, it, expect } from 'vitest'
import { isConvexOutage } from '../convexOutage'

describe('isConvexOutage', () => {
    it('recognises a disabled deployment, as a query error or a response body', () => {
        const message = '[CONVEX Q(templates:getTemplates)] [Request ID: 3efc01c0817a0af4] Server Error\n'
            + 'You have exceeded the free plan limits, so your deployments have been disabled.'
        expect(isConvexOutage(new Error(message))).toBe(true)
        expect(isConvexOutage(JSON.stringify({ status: 'error', errorMessage: message }))).toBe(true)
        expect(isConvexOutage(new Error('Cannot run functions while this deployment is paused.'))).toBe(true)
    })

    it('leaves a function that failed on its own to the usual error handling', () => {
        expect(isConvexOutage(new Error('[CONVEX Q(songs:list)] [Request ID: 1] Server Error\nUncaught Error: boom'))).toBe(false)
        expect(isConvexOutage(new Error('Cannot read properties of undefined'))).toBe(false)
        expect(isConvexOutage(undefined)).toBe(false)
    })
})
