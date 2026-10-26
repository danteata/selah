# Live sessions on the local network

A phone in the phone app and the desk on the same Wi-Fi run the live
session between themselves: the phone follows the desk's screen and drives it
(as the session's mode allows) with no internet at all. Convex is the record
and the fallback: when the desk is also in a Convex session and Convex is
reachable, what phones do over Wi-Fi reaches it too, and a phone that isn't
on the desk's Wi-Fi uses Convex as before.

- **Phone app (Android):** finds the desk over mDNS and connects to it.
- **Web app (browser):** can't reach a LAN address from an HTTPS page
  (mixed content, Private Network Access), so it stays on Convex. WebRTC data
  channels signalled through Convex would be the way; not started.

## How it fits together

- **Transport** (`crates/selah-lan`): the desk announces `_selah._tcp.local.`
  over mDNS with its id, version and church; `link.rs` is a TCP connection
  carrying one JSON object per line, with pings (a phone gone quiet for 30 s
  is dropped) and a 16 MB line limit. Plain TCP, because both ends are Rust:
  the desk app and the phone app, not a web view.
- **Trust** (`link.rs`): the operator opens a pairing window on the desk
  (Phones → Pair a phone), which shows a six-digit code for two minutes; five
  wrong codes close it. A phone that sends the code gets a 32-byte token, and
  later connections answer a fresh challenge with HMAC-SHA256(token, nonce),
  so the token never crosses the network again. Pairings live in
  `lan-devices.json` in the desk's config folder; Forget removes one.
- **Desk** (`src-tauri/src/lan.rs`, `useLanHost`, `services/lan/host.ts`):
  listens on 17494 for the life of the app. The desk's store *is* the
  session: phones get a snapshot on joining, then changed slides and session
  fields as they change. A phone's request is checked against Convex's rules
  (`protocol.ts` `refusal`, mirroring `convex/liveSessions.ts`) and applied
  through the desk's own live-session actions when it's in a Convex session,
  or to its store alone when it isn't.
- **Phone** (`mobile/src-tauri` `lan_connect`, `services/lan/link.ts`,
  `useLanSession`, `useLanAutoConnect`): connects to a paired desk on its
  own (found by discovery, or where it was last time if discovery is
  blocked), mirrors the desk into its store, and while connected
  `useLiveSession` returns the Wi-Fi session: no Convex subscriptions, and
  actions become requests to the desk. On the operator's own phone, slides
  added or edited there and the deck order go to the desk as well.
- **Who drives the screen:** a phone signed in as the desk's user, or as an
  admin of its church, runs the screen; any other paired phone contributes,
  by the mode. That's the Convex session's mode when there is one, else the
  desk's own (Phones panel), remembered.

Not done: iOS, WebRTC for the web app, handing over the operator over Wi-Fi.

## When a phone doesn't find the desk

- **Windows Firewall.** The first time Selah listens, Windows asks whether
  to allow it. If that was dismissed, or the network is set to Public,
  phones can't reach the desk. Windows Security → Firewall & network
  protection → Allow an app through firewall → Selah, on Private (and
  Public, if the church network is marked Public).
- **Guest or "isolated" Wi-Fi** keeps devices apart; nothing gets through.
- **Discovery blocked, connections not** (common on church networks): the
  desk's Phones panel shows its address; the phone can connect by address.

## Building the Android app

Needs the Android SDK and NDK (`ANDROID_HOME`, `NDK_HOME`) and the Rust
targets (`rustup target add aarch64-linux-android`).

```bash
npm run build                      # the frontend, into dist/
cd mobile
ANDROID_HOME=~/Android NDK_HOME=~/Android/ndk/27.1.12297006 \
  ../node_modules/.bin/tauri android build --debug --apk --target aarch64
# → src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

`mobile/src-tauri/Cargo.lock` is the desk's lockfile, so both build the same
Tauri version as `@tauri-apps/api` (the CLI refuses a mismatch). Gradle's
`BuildTask.kt` calls the repo's CLI script by path; regenerate with care.

The debug APK is ~164 MB: the frontend build carries `public/` (bundled
Bibles, media). A release build should fetch those instead.

## Trying it

1. Run the desk app on a computer. Open **Phones** in the top bar and choose
   **Pair a phone**.
2. In the phone app on the same Wi-Fi: the **Desk** chip on the Live view
   (or More → On this Wi-Fi) → **Pair**, and enter the code.
3. The phone follows the desk; turn the Wi-Fi router's internet off and it
   still does. Next time it connects on its own.
