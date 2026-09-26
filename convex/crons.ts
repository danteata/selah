import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Forget Paystack event keys once they are well past Paystack's retry window,
// so the dedupe table stays small.
crons.interval('prune processed Paystack events', { hours: 24 }, internal.licensing.prunePaystackEvents, {})

export default crons
