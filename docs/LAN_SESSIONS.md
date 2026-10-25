# Live sessions on the local network

Every change in a live session goes phone → Convex (US) → desk today, even
when the phone sits beside the desk on the same Wi-Fi. The aim: devices in
the room talk to each other directly, with Convex as the record and the
fallback.

- **Phone app (Android/iOS):** finds the desk over mDNS and connects to it
  directly. Works with the internet down.
- **Web app (browser):** can't reach a LAN address from an HTTPS page
  (mixed content, Private Network Access), so it would use WebRTC data
  channels signalled through Convex. Not started.

## Where the spike is (branch `spike/android-lan`)

Done:

- `crates/selah-lan`: announce and discover `_selah._tcp.local.` over mDNS
  (`mdns-sd`). Its test announces a desk and finds it on the same machine.
- Desk (`src-tauri/src/lan.rs`): `lan_announce` / `lan_stop` commands; the
  desk announces itself for its church once signed in (`useLanAnnounce`).
  Port 17494 is reserved for the session server; nothing listens yet.
- Phone app (`mobile/src-tauri`): the same React frontend wrapped by Tauri
  for Android, with one command, `discover_desks`. Kept apart from the desk
  crate, whose audio capture, ONNX Runtime and NDI don't belong on a phone.
- Frontend: `isTauriMobile()` tells the phone app from the desk (`isTauri()`
  still means the desk), so the phone app takes the web paths. The session
  sheet lists desks on the Wi-Fi in the phone app (`NearbyDesks`).
- Android: multicast lock in `MainActivity` (many phones drop multicast
  without it) and the network permissions in the manifest.

Not done: the desk's session server on 17494, the transport layer under
`useLiveSession`, pairing, iOS, WebRTC for the web app.

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

## Trying discovery

1. Run the desk app (with this branch) on a computer, signed in.
2. Install the APK on a phone on the same Wi-Fi, sign in to the same church.
3. Open the session chip on the Live view: "On this Wi-Fi" lists the desk.

Church guest networks often isolate devices from each other; then nothing
is found, and the session carries on through Convex as today.
