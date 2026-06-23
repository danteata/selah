# Desktop Google Login — Handoff Document

> Status: **RESOLVED (2026-06-22).** The system-browser flow described
> below was implemented, and the click-does-nothing bug was fixed.
>
> Root cause of "Continue with Google does nothing": Clerk types
> `firstFactorVerification.externalVerificationRedirectURL` as
> `URL | null` (a `URL` instance), but `getExternalVerificationRedirectURL`
> in `src/hooks/useClerkAuth.ts` only returned it when
> `typeof url === 'string'`. So it always returned `null`,
> `startTauriOAuth` threw, the error was swallowed, and the OAuth URL
> was never opened. Fixed by accepting `URL` instances
> (`url.toString()`).
>
> Additional robustness fixes shipped at the same time:
> - `src-tauri/src/oauth_listener.rs` now navigates the webview with a
>   root-relative `/?<query>` (origin-correct in dev AND prod) instead
>   of reading `build.dev_url`, which stays `http://localhost:3000`
>   even in production builds. It also calls `set_focus()` to bring the
>   app forward after the system browser steals focus.
> - `src/App.tsx` drives the callback screen off `isSignedIn` and
>   clears the URL/latch once the session lands, instead of latching on
>   `__clerk_handshake` forever (which left users stuck on the spinner
>   after Clerk consumed the param).
> - `src/pages/auth/DesktopOAuthCallback.tsx` has a 20s timeout fallback
>   and only mounts `<AuthenticateWithRedirectCallback />` for the
>   code/nonce/ticket flow (the handshake is handled by ClerkProvider).
> - `src/hooks/useOAuthCallback.ts` no longer subscribes to the
>   `oauth://callback` event to re-navigate the webview — the Rust-side
>   navigation is now authoritative, so the JS backup only added a race.
>
> The historical analysis below is kept for context.

This document captures everything tried, the root cause, and the recommended fix so the next person can pick this up without re-deriving the flow.

---

## TL;DR

The Tauri webview is currently being used as the OAuth sign-in surface. Clerk's hosted Account Portal treats the opener window (`window.opener`) as the handshake target and sends the result via `window.opener.postMessage(...)`. After the user signs in:

1. The webview's `window.opener` resolves to the webview itself.
2. The webview has navigated to Clerk's domain, so the React app (and the Clerk React SDK) is no longer mounted there.
3. Clerk's `postMessage` lands in a window with no listener.
4. The webview sits on the Account Portal's "Welcome" page forever.

The two preventive fixes I applied (correct post-handshake navigation in Rust, and `redirectUrlComplete: '/'` in the hook) are correct hygiene, but they don't address the broken delivery. The Account Portal still never sends the handshake because it's still using the popup-opener channel that has no listener.

The proper fix is to **stop using the Tauri webview as the OAuth surface** and instead open the OAuth URL in the **system browser** via `@tauri-apps/plugin-shell` `open()`. The system browser has its own Clerk session cookies; on success, Clerk redirects to the Rust listener at `http://localhost:19888/oauth-callback?__clerk_handshake=...`. The Rust listener navigates the Tauri webview to the React app with the handshake still in the query, and `App.tsx`'s existing handshake check takes over.

---

## Flow as it stands today

```
┌──────────────────────────────────────────────────────────────────┐
│ Tauri webview (origin: http://localhost:3000 in dev,             │
│                tauri://localhost in prod)                        │
├──────────────────────────────────────────────────────────────────┤
│  1. User clicks "Continue with Google" in DesktopWelcome.tsx     │
│  2. useClerkAuth.handleGoogleSignIn()                            │
│       signIn.authenticateWithRedirect({                          │
│         strategy: 'oauth_google',                                │
│         redirectUrl: 'http://localhost:19888/oauth-callback',    │
│         redirectUrlComplete: '/',                                │
│       })                                                         │
│  3. Clerk React SDK does window.location.assign to               │
│     https://<clerk-instance>/v1/accounts/signin/...              │
│     ↑ webview now leaves the React app and lands on Clerk's      │
│       hosted Account Portal                                      │
│                                                                  │
│  4. User completes Google OAuth in the Account Portal            │
│                                                                  │
│  5. Account Portal shows "Welcome, you are signed in" page       │
│     and attempts: window.opener.postMessage({handshake}, '*')   │
│     ↑ window.opener is the Tauri webview itself                  │
│     ↑ but the webview is on Clerk's domain, so the React         │
│       app / Clerk SDK is unmounted → no listener → message lost   │
│                                                                  │
│  6. [STUCK HERE] Webview sits on "Welcome" page indefinitely      │
└──────────────────────────────────────────────────────────────────┘
```

The Rust listener **is** reachable (the logs earlier confirmed `callback received: /oauth-callback?__clerk_handshake=...` — that was from a manual test where the user got past the Welcome page somehow). The break is between step 5 and step 6: the handshake never makes it to the webview, so the user has to relaunch to land on the dashboard (the session cookie is set in the browser, so the next launch's `ClerkProvider` finds it).

---

## What's already done (correct, keep)

### 1. `src-tauri/src/oauth_listener.rs` — `webview.eval` uses the right origin

The Rust one-shot HTTP listener at `http://localhost:19888/oauth-callback` navigates the webview via `window.location.href = …`. The old code used a root-relative `/?<query>`, which after the redirect-to-listener step resolved to `http://localhost:19888/?<query>` (the now-closed Rust server) → blank page.

**Fix:** read the configured dev URL from `app.config().build.dev_url`, fall back to `tauri://localhost` in production, and construct the full URL:

```rust
let origin = app_handle
    .config()
    .build
    .dev_url
    .as_ref()
    .map(|u| u.as_str().trim_end_matches('/').to_string())
    .unwrap_or_else(|| "tauri://localhost".to_string());
let nav_script = format!(
    "window.location.href = '{}/?{}';",
    origin,
    query_only.trim_start_matches('?')
);
```

This is correct, regardless of which fix lands for the Welcome page issue.

### 2. `src/hooks/useClerkAuth.ts` — `getOAuthRedirectComplete()` returns `/`

After the React app processes the handshake, the SDK navigates to `redirectUrlComplete`. The old code pointed this at `http://localhost:19888/oauth-callback` (the Rust listener), which is one-shot and would 404. Now it returns `/`, so the SDK lands on the React app's root (the dashboard) on whichever origin the webview is currently on.

```ts
function getOAuthRedirectComplete(): string {
    if (isTauri()) {
        // Relative to the webview's current origin, which is the
        // React app's Vite dev URL in dev (http://localhost:3000)
        // or the Tauri asset server in production
        // (tauri://localhost). The Rust listener is one-shot and
        // already closed by the time the SDK gets here, so we
        // must NOT point it back at the listener URL.
        return '/'
    }
    return '/'
}
```

### 3. `src/pages/DesktopWelcome.tsx` — GoogleButton has `type="button"`

The old button had no `type` attribute, defaulting to `type="submit"`. Inside the surrounding `<form>`, clicking it submitted the form and the first focusable input (the email field) was activated — that was the "focus jumps to email" symptom from earlier in the session.

```tsx
<button
    type="button"
    onClick={onClick}
    disabled={isLoading}
    ...
>
```

### 4. `src/hooks/useClerkAuth.ts` — Google handlers no longer reference broken imports

`isDesktop` and `startDesktopOAuth` were used in `handleGoogleSignIn` / `handleGoogleSignUp` but never imported. Both were always `undefined`, so the `if (isDesktop)` branch was always falsy and the flow silently fell through to the web path with a broken relative `redirectUrl`. Replaced with a local `isTauri()` helper and a `getOAuthRedirectUrl()` that reads `window.__SELAH_OAUTH_URL__` (set by `useOAuthCallback` in `App.tsx`) on Tauri, falling back to the hardcoded `http://localhost:19888/oauth-callback` if the hook hasn't mounted yet, and `window.location.origin + '/sso-callback'` on web.

---

## Files involved

| File | Role | State |
|---|---|---|
| `src/hooks/useClerkAuth.ts` | Issues `signIn.authenticateWithRedirect(...)` and `signUp.authenticateWithRedirect(...)` for the Google buttons in `DesktopWelcome` | Preventive fixes in place (correct Tauri/web split, `redirectUrlComplete: '/'`) |
| `src/hooks/useOAuthCallback.ts` | Mounts `window.__SELAH_OAUTH_URL__`; listens for `oauth://callback` Tauri event and navigates the webview to `/desktop-oauth-callback`. Has a `tauri://localhost`-only guard that skips subscribing on Vite dev origin | Unchanged, but becomes a no-op in dev under the recommended fix |
| `src/hooks/useDeepLinkOAuth.ts` | Listens for `selah://...` deep links. Currently unused by the Google flow but kept around | Likely to be removed/deprecated under the recommended fix |
| `src/App.tsx` | Top-level routes. Has a `?__clerk_handshake` query-string check that renders `<DesktopOAuthCallback />` directly, bypassing React Router. Mounts `useOAuthCallback` and `useDeepLinkOAuth` inside `<ClerkProvider>` | Unchanged. Still does the heavy lifting once the handshake lands in the webview's URL |
| `src/pages/auth/DesktopOAuthCallback.tsx` | Page mounted at `/desktop-oauth-callback` that renders `<AuthenticateWithRedirectCallback />` from Clerk's React SDK. The "Completing sign-in…" spinner | Unchanged. Reachable in prod via the `useOAuthCallback` hook's navigation, or via `App.tsx`'s direct handshake check on `/` |
| `src/pages/DesktopWelcome.tsx` | Desktop welcome screen with the "Continue with Google" button | Preventive fix in place (`type="button"`) |
| `src/pages/auth/Login.tsx`, `src/pages/auth/Signup.tsx` | Web auth pages. Both have a working Google flow already (the `DesktopWelcome` flow was the only broken one). `Signup.tsx` still imports a non-existent `startDesktopOAuth` from `../../utils/auth` (unrelated — leave alone) | Working |
| `src-tauri/src/oauth_listener.rs` | One-shot HTTP listener on port 19888 that captures the OAuth callback. Navigates the webview to the React app with the handshake in the query | Preventive fix in place (proper origin) |

---

## The recommended fix (system browser)

Replace the in-webview `signIn.authenticateWithRedirect(...)` flow with one that opens the OAuth URL in the system browser. The shape:

```ts
// in handleGoogleSignIn / handleGoogleSignUp
if (isTauri()) {
    // 1. Create the sign-in attempt so Clerk issues a handshake
    const { signIn, signUp } = await Promise.all([
        // signIn or signUp depending on the mode
        signInOrSignUp.create({ strategy: 'oauth_google', redirectUrl: TAURI_OAUTH_REDIRECT_URL }),
    ])
    // 2. Get the OAuth URL Clerk wants to send the user to
    const oauthUrl = signInOrSignUp.firstFactorVerification.externalVerificationRedirectURL
    // 3. Hand it to the system browser
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(oauthUrl)
    // 4. The system browser does the OAuth and lands on
    //    http://localhost:19888/oauth-callback?__clerk_handshake=...
    // 5. Rust listener navigates the webview to the React app
    // 6. App.tsx picks up the handshake and renders DesktopOAuthCallback
} else {
    // existing web path — unchanged
}
```

Notes:

- The Clerk SDK has a method to get the OAuth URL without doing a navigation; the exact method name varies by version (it may be `signIn.create({ strategy, redirectUrl })` followed by reading `firstFactorVerification.externalVerificationRedirectURL`, or `signIn.authenticateWithRedirect(...)` which we wrap in `await` and read the result).
- `open()` from `@tauri-apps/plugin-shell` is a thin wrapper around the OS's default browser. It needs the `shell:allow-open` capability, which `tauri.conf.json` already grants via the `shell` plugin (`"open": true` in `plugins.shell`).
- The Rust listener + `App.tsx` handshake check + `DesktopOAuthCallback` page are already correct; **the new code path only swaps the in-webview `window.location.assign` for an `open()` call**. Everything downstream is reusable.
- On the web build, the `else` branch is unchanged.
- The `useDeepLinkOAuth` hook is no longer needed for this flow and can be deleted. The `selah://` deep-link scheme in `tauri.conf.json` can also be removed.

---

## Testing checklist (after the fix is implemented)

1. **Clean Tauri dev session, no existing session cookie:**
   - Launch app, land on `DesktopWelcome`
   - Click "Continue with Google"
   - System browser opens to Clerk's hosted sign-in
   - Sign in with Google
   - System browser redirects to `http://localhost:19888/oauth-callback?__clerk_handshake=...`
   - Tauri webview auto-focuses and lands on the dashboard
   - No white screen. No "Welcome" page. No manual restart needed.
2. **Tauri dev with a stale session cookie:**
   - Already signed in via the web build; launch the Tauri app
   - Should land on the dashboard immediately, not the welcome screen
3. **Tauri prod build (`tauri build && open the app`):**
   - Same as dev but with `tauri://localhost` as the webview origin
4. **Web build (`bun run dev` in browser, no Tauri):**
   - Click "Continue with Google" on `/login` and `/signup`
   - Should work exactly as it does today (the `else` branch)
5. **Sign-up flow:**
   - Click "Create Account" first, then "Continue with Google" on the sign-up form
   - Should land on the dashboard with a fresh account
6. **Failed OAuth (user closes system browser mid-flow):**
   - No state change, user stays on `DesktopWelcome`
   - No leaked Rust listener (already one-shot and reaped)
7. **Verify the cleanup:**
   - `grep -r "useDeepLinkOAuth" src/` — should be empty
   - `grep -r "selah://" src-tauri/` — should be empty (the deep-link plugin entry in `tauri.conf.json` can also go)

---

## Open questions

- **Why does the user see a "Welcome" page and not a redirect?**

  The hosted Account Portal is showing its post-signin success state and waiting to send the handshake via `postMessage` to the opener. In a normal web flow, the opener is a small popup window that's still running the React app, and Clerk closes the popup after the `postMessage` lands. In the Tauri webview, the opener is the same window that just navigated to Clerk's domain, so the React app is unmounted and the `postMessage` is dropped. We could confirm by inspecting the Account Portal's JavaScript in DevTools (Tauri's webview has DevTools enabled in `tauri.conf.json` — `"devtools": true`).

- **Is there a way to force the Account Portal to do a full redirect instead of a popup?**

  Possibly, via Clerk's hosted sign-in URL parameters (`?redirect_url=...` or `?embedded=...`). Worth a quick check, but the system-browser approach is more reliable and idiomatic for Tauri, so I'd start there.

- **Does the existing `useDeepLinkOAuth` hook get reused?**

  No. With the system-browser flow, the OAuth redirect lands on `http://localhost:19888/oauth-callback` (the Rust listener), not on `selah://...`. The `selah://` deep-link scheme becomes dead code. Recommend deleting both the hook and the `deep-link` plugin entry in `tauri.conf.json`.

- **What about the `window.__SELAH_OAUTH_URL__` bridge in `useOAuthCallback`?**

  Still useful for the system-browser flow if we want the OAuth URL to be the one the Rust listener is bound to (so we can confirm the port is free before opening the browser). Not strictly required — the hardcoded `http://localhost:19888/oauth-callback` fallback in `useClerkAuth.ts` is fine.

---

## Reference: where to look in the code

| Question | File | Lines |
|---|---|---|
| Where does the Google click originate? | `src/pages/DesktopWelcome.tsx` | `GoogleButton` (≈263), `SignInForm` (≈308), `SignUpAccountForm` (≈391) |
| Where does the click become a Clerk call? | `src/hooks/useClerkAuth.ts` | `handleGoogleSignIn` (≈75), `handleGoogleSignUp` (≈125) |
| Where is the URL the OAuth is opened from? | `src/hooks/useClerkAuth.ts` | `getOAuthRedirectUrl()` (≈19) |
| Where is the Rust listener bound? | `src-tauri/src/oauth_listener.rs` | `start_oauth_listener` (≈66) |
| Where does the Rust listener navigate the webview? | `src-tauri/src/oauth_listener.rs` | webview `eval` block (≈142) |
| Where does the React app pick up the handshake? | `src/App.tsx` | `oauthCallbackSearch` state + `useEffect` (≈140), the `if (oauthCallbackSearch)` early-return (≈181) |
| Where is the Clerk callback component mounted? | `src/pages/auth/DesktopOAuthCallback.tsx` | whole file (75 lines) |
| Where is the system-browser capability configured? | `src-tauri/tauri.conf.json` | `plugins.shell` (≈89), `plugins.deep-link` (≈92) — the latter is for the dead-code `selah://` flow |
| Where is the Tauri webview's dev URL? | `src-tauri/tauri.conf.json` | `build.devUrl` (≈10) |

---

## What I would NOT do

- **Don't** try to make the in-webview hosted sign-in work. The Account Portal's popup-opener model is a Clerk-side concern; the only robust Tauri-idiomatic fix is the system browser.
- **Don't** add a second listener port or make the Rust listener multi-shot. The fix is upstream of the listener — the listener itself is already correct.
- **Don't** add `?embedded=true` or any other hosted-sign-in URL parameter hoping it forces a full redirect. Untested, undocumented, and would need a Clerk support ticket to confirm. The system-browser approach is the well-trodden path.
- **Don't** revert any of the four preventive fixes above. They're correct hygiene that the new flow also benefits from.
