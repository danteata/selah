import { sha256 } from '@noble/hashes/sha2.js'

function toHex(bytes: Uint8Array): string {
    let hex = ''
    for (const b of bytes) hex += b.toString(16).padStart(2, '0')
    return hex
}

/**
 * One key per Paystack event, the same on every redelivery of it.
 *
 * Built from the event type and the id of its object (the transaction,
 * invoice or subscription; charges also carry a reference), plus that
 * object's status and timestamps. The id alone isn't enough: Paystack sends
 * `invoice.update` more than once for one invoice as it moves from pending to
 * paid, and keyed on the id the later, meaningful update would be dropped as a
 * repeat. A redelivery is byte-identical, so it still matches exactly. With no
 * id at all, the raw body stands in.
 */
export function paystackEventKey(
    event: { event?: string; data?: Record<string, unknown> },
    raw: string,
): string {
    const type = event.event ?? 'unknown'
    const data = event.data ?? {}
    const id = data.id ?? data.reference ?? data.subscription_code ?? data.invoice_code
    if (id == null || id === '') {
        return `${type}:sha256:${toHex(sha256(new TextEncoder().encode(raw)))}`
    }
    const version = [data.status, data.paid_at, data.updated_at ?? data.updatedAt]
        .filter((part) => part != null && part !== '')
        .join('|')
    return version ? `${type}:${id}:${version}` : `${type}:${id}`
}
