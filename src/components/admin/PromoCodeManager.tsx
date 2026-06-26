/**
 * PromoCodeManager — superadmin UI for creating and managing promo codes.
 *
 * Backed by the superadmin-gated Convex functions in convex/promos.ts
 * (adminListPromoCodes / adminCreatePromoCode / adminSetPromoActive). Rendered
 * inside the Dashboard admin panel; only shown to superadmins.
 *
 * Two kinds (mirrors the backend):
 *   comp     → free Pro for N days, no payment.
 *   discount → first N billing cycles on a cheaper Paystack plan, then auto
 *              reverts to the normal plan. Requires an intro plan in Paystack
 *              configured with invoice_limit = introCycles.
 */

import { useState } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { toast } from 'sonner'
import { Ticket, Plus, Power } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import { useUserRole } from '../../hooks/useUserRole'

type Kind = 'comp' | 'discount'

interface PromoCodeManagerProps {
    onClose?: () => void
}

export function PromoCodeManager({ onClose }: PromoCodeManagerProps) {
    const { isSuperadmin, isLoading } = useUserRole()
    const codes = useQuery(api.promos.adminListPromoCodes, isSuperadmin ? {} : 'skip')
    const createCode = useMutation(api.promos.adminCreatePromoCode)
    const setActive = useMutation(api.promos.adminSetPromoActive)

    const [kind, setKind] = useState<Kind>('comp')
    const [code, setCode] = useState('')
    const [description, setDescription] = useState('')
    const [maxRedemptions, setMaxRedemptions] = useState('')
    const [expiresAt, setExpiresAt] = useState('')
    const [compDays, setCompDays] = useState('30')
    const [introPlanCode, setIntroPlanCode] = useState('')
    const [introCycles, setIntroCycles] = useState('3')
    const [revertPlanCode, setRevertPlanCode] = useState('')
    const [busy, setBusy] = useState(false)

    if (!isLoading && !isSuperadmin) {
        return (
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-tertiary)] p-6 text-center text-sm text-[var(--text-secondary)]">
                Only superadmins can manage promo codes.
            </div>
        )
    }

    async function submit() {
        const trimmed = code.trim().toUpperCase()
        if (!trimmed) return toast.error('Enter a code')
        setBusy(true)
        try {
            await createCode({
                code: trimmed,
                kind,
                description: description.trim() || undefined,
                maxRedemptions: maxRedemptions ? Number(maxRedemptions) : null,
                expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
                ...(kind === 'comp'
                    ? { compDays: Number(compDays) }
                    : {
                          introPlanCode: introPlanCode.trim(),
                          introCycles: Number(introCycles),
                          revertPlanCode: revertPlanCode.trim() || undefined,
                      }),
            })
            toast.success(`Created ${trimmed}`)
            setCode('')
            setDescription('')
            setMaxRedemptions('')
            setExpiresAt('')
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not create code')
        } finally {
            setBusy(false)
        }
    }

    async function toggle(c: { code: string; active: boolean }) {
        try {
            await setActive({ code: c.code, active: !c.active })
            toast.success(`${c.code} ${c.active ? 'disabled' : 'enabled'}`)
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not update code')
        }
    }

    const inputCls =
        'w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-teal)]'
    const labelCls = 'block text-xs font-medium text-[var(--text-tertiary)] mb-1'

    return (
        <div className="space-y-6">
            {/* Create form */}
            <div className="rounded-lg border border-[var(--border-default)] p-4">
                <div className="mb-3 flex items-center gap-2">
                    <Plus className="h-4 w-4 text-[var(--accent-teal)]" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">New promo code</h3>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={labelCls}>Code</label>
                        <input
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            placeholder="LAUNCH50"
                            className={`${inputCls} uppercase`}
                        />
                    </div>
                    <div>
                        <label className={labelCls}>Kind</label>
                        <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={inputCls}>
                            <option value="comp">Comp — free Pro for N days</option>
                            <option value="discount">Discount — N cycles then normal</option>
                        </select>
                    </div>

                    <div className="col-span-2">
                        <label className={labelCls}>Description (optional)</label>
                        <input
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Launch promo"
                            className={inputCls}
                        />
                    </div>

                    {kind === 'comp' ? (
                        <div>
                            <label className={labelCls}>Free days</label>
                            <input
                                type="number"
                                min={1}
                                value={compDays}
                                onChange={(e) => setCompDays(e.target.value)}
                                className={inputCls}
                            />
                        </div>
                    ) : (
                        <>
                            <div>
                                <label className={labelCls}>Intro plan code (Paystack)</label>
                                <input
                                    value={introPlanCode}
                                    onChange={(e) => setIntroPlanCode(e.target.value)}
                                    placeholder="PLN_intro50"
                                    className={inputCls}
                                />
                            </div>
                            <div>
                                <label className={labelCls}>Discounted cycles</label>
                                <input
                                    type="number"
                                    min={1}
                                    value={introCycles}
                                    onChange={(e) => setIntroCycles(e.target.value)}
                                    className={inputCls}
                                />
                            </div>
                            <div className="col-span-2">
                                <label className={labelCls}>Revert plan code (optional — defaults to normal Pro)</label>
                                <input
                                    value={revertPlanCode}
                                    onChange={(e) => setRevertPlanCode(e.target.value)}
                                    placeholder="PLN_pro"
                                    className={inputCls}
                                />
                            </div>
                        </>
                    )}

                    <div>
                        <label className={labelCls}>Max redemptions (blank = unlimited)</label>
                        <input
                            type="number"
                            min={1}
                            value={maxRedemptions}
                            onChange={(e) => setMaxRedemptions(e.target.value)}
                            className={inputCls}
                        />
                    </div>
                    <div>
                        <label className={labelCls}>Expires (optional)</label>
                        <input
                            type="date"
                            value={expiresAt}
                            onChange={(e) => setExpiresAt(e.target.value)}
                            className={inputCls}
                        />
                    </div>
                </div>

                {kind === 'discount' && (
                    <p className="mt-2 text-xs text-[var(--text-tertiary)]">
                        The intro plan in Paystack must have <code>invoice_limit</code> set to the
                        discounted-cycles value so it stops automatically before the rollover.
                    </p>
                )}

                <button
                    onClick={submit}
                    disabled={busy}
                    className="mt-4 rounded-md bg-[var(--accent-teal)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                    {busy ? 'Creating…' : 'Create code'}
                </button>
            </div>

            {/* Existing codes */}
            <div>
                <div className="mb-2 flex items-center gap-2">
                    <Ticket className="h-4 w-4 text-[var(--text-tertiary)]" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                        Existing codes {codes ? `(${codes.length})` : ''}
                    </h3>
                </div>

                {codes === undefined ? (
                    <p className="text-sm text-[var(--text-tertiary)]">Loading…</p>
                ) : codes.length === 0 ? (
                    <p className="text-sm text-[var(--text-tertiary)]">No promo codes yet.</p>
                ) : (
                    <div className="overflow-hidden rounded-lg border border-[var(--border-default)]">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-[var(--bg-tertiary)] text-xs text-[var(--text-tertiary)]">
                                <tr>
                                    <th className="px-3 py-2">Code</th>
                                    <th className="px-3 py-2">Kind</th>
                                    <th className="px-3 py-2">Details</th>
                                    <th className="px-3 py-2">Used</th>
                                    <th className="px-3 py-2">Status</th>
                                    <th className="px-3 py-2"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {codes.map((c) => (
                                    <tr
                                        key={c._id}
                                        className="border-t border-[var(--border-subtle)] text-[var(--text-secondary)]"
                                    >
                                        <td className="px-3 py-2 font-mono text-[var(--text-primary)]">{c.code}</td>
                                        <td className="px-3 py-2">{c.kind}</td>
                                        <td className="px-3 py-2">
                                            {c.kind === 'comp'
                                                ? `${c.compDays} days free`
                                                : `${c.introCycles} cycles @ ${c.introPlanCode}`}
                                            {c.expiresAt && (
                                                <span className="block text-xs text-[var(--text-tertiary)]">
                                                    expires {new Date(c.expiresAt).toLocaleDateString()}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2">
                                            {c.timesRedeemed}
                                            {c.maxRedemptions != null ? ` / ${c.maxRedemptions}` : ''}
                                        </td>
                                        <td className="px-3 py-2">
                                            <span
                                                className={
                                                    c.active
                                                        ? 'text-green-600 dark:text-green-400'
                                                        : 'text-[var(--text-tertiary)]'
                                                }
                                            >
                                                {c.active ? 'active' : 'disabled'}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <button
                                                onClick={() => toggle(c)}
                                                title={c.active ? 'Disable' : 'Enable'}
                                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                                            >
                                                <Power className="h-3.5 w-3.5" />
                                                {c.active ? 'Disable' : 'Enable'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {onClose && (
                <div className="flex justify-end">
                    <button
                        onClick={onClose}
                        className="rounded-md border border-[var(--border-default)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                    >
                        Done
                    </button>
                </div>
            )}
        </div>
    )
}
