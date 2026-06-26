# Selah licensing (signed offline licenses + Paystack)

Selah gates Pro features with **Ed25519-signed license files** that the desktop
app verifies **completely offline**. Paystack handles billing; **Convex** is the
backend that talks to Paystack and mints licenses. The app never holds a Paystack
secret and never talks to Paystack directly.

```
[Paystack subscription] --webhook--> [Convex] --issues--> [signed license] --cached locally--> [Tauri verifies offline]
                                        ^                                                          |
                                        |------------------ GET /license (Clerk JWT) --------------|
```

## What changed vs. the original design

The original sketch assumed a brand-new standalone backend. Selah already has
one — **Convex** (with Clerk auth and an HTTP router) — so the webhook, license
issuance, and signing all live there. Other corrections baked in:

- **Sign exact bytes, ship exact bytes.** The license file carries
  `payload_b64` = base64 of the precise JSON bytes that were signed. The client
  verifies the signature over those bytes, *then* parses. No canonical-JSON
  mismatch is possible (the original "gotcha" is eliminated rather than worked
  around).
- **Raw 32-byte keys, not PEM.** `ed25519-dalek` v2 (`VerifyingKey::from_bytes`)
  on the client and `@noble/ed25519` on Convex both use raw keys — simpler than
  OpenSSL PEM plumbing.
- **Secret key moved server-side.** The old client `PaystackAdapter` used the
  Paystack *secret* key in the browser/desktop bundle. That's gone; privileged
  calls run in `convex/paystack.ts`.
- **Anti-rollback.** The app records the highest timestamp it has ever seen and
  evaluates expiry against `max(now, max_seen)`, so winding the system clock back
  can't extend the grace window forever.
- **Key rotation + revocation hooks.** `key_id` selects the verifying key;
  `license_id` is carried for a future revocation list.

## Pieces

| Layer | File | Role |
|---|---|---|
| Schema | `convex/schema.ts` | `subscriptions` table (source of truth) |
| Signing + data | `convex/licensing.ts` | build + Ed25519-sign payload, upsert from webhook |
| Paystack (server) | `convex/paystack.ts` | checkout init, manage link, `getMySubscription` |
| HTTP | `convex/http.ts` | `POST /paystack/webhook`, `GET /license` |
| Verify (client) | `src-tauri/src/license.rs` | offline verify + expiry/grace/anti-rollback |
| Entitlements | `src/providers/LicenseProvider.tsx` | `useEntitlements()` for the whole app |
| Gating UI | `src/components/licensing/*` | `ProGate`, `ProUpsell`, `SubscriptionBanner` |
| Keygen | `scripts/gen-license-keys.mjs` | generate the keypair |

## License file format

```json
{
  "alg": "ed25519",
  "key_id": "k1",
  "payload_b64": "<base64 of the exact UTF-8 JSON bytes signed>",
  "signature": "<base64 ed25519 signature over those bytes>"
}
```

Decoded payload:

```json
{
  "v": 1, "key_id": "k1", "license_id": "lic_user@example.com_2026-06-26T...",
  "user_id": "...", "email": "user@example.com",
  "plan": "pro", "status": "active",
  "issued_at": "2026-06-26T00:00:00.000Z",
  "expires_at": "2026-07-26T00:00:00.000Z",
  "grace_period_days": 14
}
```

`expires_at` is the end of the current paid period; `grace_period_days` is how
long Pro keeps working past it while the app can't reach the server.

## Setup

1. **Generate keys**

   ```bash
   node scripts/gen-license-keys.mjs
   ```

2. **Configure Convex** (`npx convex env set …`)

   ```
   LICENSE_SIGNING_KEY     = <seed hex from step 1>
   PAYSTACK_SECRET_KEY     = sk_live_xxx           # also verifies webhook HMAC
   PAYSTACK_PRO_PLAN_CODE  = PLN_xxx               # monthly Pro plan in Paystack
   PAYSTACK_CALLBACK_URL   = https://app.example/billing/return   # optional
   ```

3. **Bake the public key into the app** — paste the printed `PUBLIC_KEY_BYTES`
   into `src-tauri/src/license.rs`, or set `SELAH_LICENSE_PUBLIC_KEY_HEX` at
   build time. (A dev key is baked in already so the chain works out of the box.)

4. **Register the Paystack webhook** → `https://<deployment>.convex.site/paystack/webhook`.
   Paystack signs it with HMAC-SHA512 of your secret key; the handler verifies it.

5. **Migrate legacy plans** (one-time, renames `teams` → `pro`):

   ```bash
   npx convex run migration:migrateTeamsToPro
   ```

## Using it in the UI

```tsx
import { useEntitlements } from '@/providers/LicenseProvider'
import { ProGate } from '@/components/licensing/ProGate'
import { SubscriptionBanner } from '@/components/licensing/SubscriptionBanner'

// Whole-feature gate:
<ProGate feature="NDI output"><NdiPanel /></ProGate>

// Inline:
const { isPro, inGrace, startProCheckout } = useEntitlements()

// Renewal nudges near the app shell top:
<SubscriptionBanner />
```

## User billing flow

The end-to-end journey a user actually experiences. Every "Pro unlocks" step
is the app re-reading entitlements from `useEntitlements()` — there is no manual
"activate" step.

### Upgrade (free → Pro)

1. User hits a gated feature (`<ProGate>` → `ProUpsell`) or a pricing button and
   clicks **Upgrade to Pro**, calling `startProCheckout()`.
2. The app asks Convex (`paystack.initializeProCheckout`, authenticated by the
   Clerk session) to create a transaction against `PAYSTACK_PRO_PLAN_CODE`.
3. The Paystack **hosted checkout** opens — in the system browser on desktop
   (`shell.open`), a new tab on web. The card is entered on Paystack, never in
   Selah.
4. On success Paystack auto-creates the subscription and fires
   `subscription.create` + `charge.success` → our webhook upserts the
   `subscriptions` row as `active` with `currentPeriodEnd`.
5. The user returns to the app. Entitlements refresh:
   - **Desktop** — `LicenseProvider` calls `fetch_and_store_license`, which pulls
     a freshly signed license from `GET /license` and caches it locally.
     `useEntitlements().isPro` flips to `true` and Pro UI unlocks.
   - **Web** — the `getMySubscription` query is reactive and updates on its own.
   - If the desktop refresh hasn't run yet, the user can trigger it via
     `refresh()` (e.g. a "I've paid" button on the return screen).

```
 free ──Upgrade──▶ Paystack hosted checkout ──pay──▶ webhook: active
   ▲                                                     │
   │                                          app refresh license/sub
   └──────────────── Pro unlocked ◀──────────────────────┘
```

### Renewal (steady state)

- Paystack charges the card automatically each period and fires `charge.success`
  / `invoice.update`; the webhook moves `currentPeriodEnd` forward. This is
  **silent** — no user action.
- Within **7 days** of `currentPeriodEnd`, `SubscriptionBanner` shows a soft
  reminder (and notes if auto-renew is off, i.e. `non-renewing`).

### Failed payment / expiry / grace

```
active ──payment fails──▶ past_due ──(Paystack retries)──┬──retry ok──▶ active
                          (still Pro)                     └──final fail / disable──▶ non-renewing
                                                                                         │
                                              currentPeriodEnd passes ──────────────────┘
                                                                                         ▼
                                              expires_at reached ──▶ in grace (Pro still on,
                                                                     "reconnect to renew" banner)
                                                                                         │
                                              grace_period_days elapse ─────────────────┘
                                                                                         ▼
                                                                            past grace ──▶ free (locked)
```

- **`past_due`** — a charge failed but Paystack is retrying. The user keeps Pro;
  we do **not** lock them out mid-retry.
- **In grace** — past `expires_at` but within `grace_period_days`. Pro stays on
  so offline/traveling users aren't cut off; the amber "reconnect to renew"
  banner shows. The grace window is enforced offline by the signed license and
  protected against clock-rollback.
- **Past grace** — entitlement drops to `free`; gated features show the upsell
  and the red "subscription ended" banner offers **Renew**.

### Manage / cancel

- The user clicks **Manage** (`manageSubscription()`), which fetches a Paystack
  **hosted management link** (`paystack.getSubscriptionManageLink`) and opens it
  to update the card or cancel. Selah never stores Paystack email tokens.
- On cancel, Paystack fires `subscription.disable` → status `non-renewing`. The
  user keeps Pro until `currentPeriodEnd`, then naturally falls back to free.

## Webhook → state mapping

| Paystack event | Result |
|---|---|
| `subscription.create` | status `active`, store codes + `next_payment_date` |
| `charge.success` (subscription) | status `active`, extend period |
| `invoice.create` / `invoice.update` | `active` on success, else `past_due` |
| `invoice.payment_failed` | `past_due` — **no downgrade** (Paystack auto-retries) |
| `subscription.disable` / `not_renew` | `non-renewing` — let the period run out |

Pro is kept through `past_due` / `non-renewing` until `currentPeriodEnd` actually
passes, so users are never locked out mid-retry-cycle.

## Rotating keys

1. `node scripts/gen-license-keys.mjs` → new pair.
2. Bump `LICENSE_KEY_ID` in `convex/licensing.ts` and set the new
   `LICENSE_SIGNING_KEY`.
3. Add the new public key under its `key_id` in `license.rs::public_key_for`
   (keep the old one until everyone has refreshed), and ship that build.
