# Selah Desktop — Auto-Updater Setup

This document explains how the Tauri auto-updater is wired in, how to test
it locally, and what you need to do before the first production release.

## What's already in place

| Piece | Location | Status |
|---|---|---|
| Rust plugin | `Cargo.toml` line 52 (`tauri-plugin-updater`) | ✓ |
| Rust plugin | `Cargo.toml` line 53 (`tauri-plugin-process`, for `app.restart()`) | ✓ |
| Plugin init | `src-tauri/src/main.rs` | ✓ wired |
| Process plugin init | `src-tauri/src/main.rs` | ✓ wired |
| `check_update` command | `src-tauri/src/main.rs` | ✓ registered |
| Updater capability | `src-tauri/capabilities/default.json` (`updater:default`) | ✓ |
| Process capability | `src-tauri/capabilities/default.json` (`process:default`) | ✓ |
| Frontend hook | `src/hooks/useAppUpdater.ts` | ✓ |
| Settings UI | `src/components/settings/SettingsModal.tsx` (Updates tab) | ✓ |
| Local dev manifest | `latest.json` (placeholder, served on port 8787) | ✓ |
| Manifest template | `latest.json.template` (for production releases) | ✓ |
| Dev server | `scripts/serve-updates.mjs` + `npm run updater:serve` | ✓ |

## Local dev test

1. Open a terminal at the project root and start the manifest server:

   ```bash
   npm run updater:serve
   ```

   You should see:

   ```
   [serve-updates] Serving /path/to/selah at http://localhost:8787
   [serve-updates] Manifest URL: http://localhost:8787/latest.json
   ```

2. Verify it's reachable from the browser:

   ```bash
   curl http://localhost:8787/latest.json
   ```

3. In another terminal, start the desktop app:

   ```bash
   npm run tauri:dev
   ```

4. In the app, open **Settings → Updates → Check for updates**. You
   should see:

   - The Tauri plugin hits `http://localhost:8787/latest.json`.
   - It sees `version: "0.99.0"` (newer than your running build).
   - It tries to verify the signature — **this is where it will fail
     in dev** because `latest.json` ships with a placeholder
     `PLACEHOLDER_SIGNATURE_WILL_FAIL_VERIFICATION`.
   - The error toast is the success criterion for "the updater chain
     is wired up correctly". If you get an error, the chain is alive.

5. (Optional) For an end-to-end install test, build a release artifact,
   sign it with your key, and place it next to `latest.json`:

   ```bash
   # One-time key gen
   cargo tauri signer generate -w ~/.tauri/selah.key

   # Build a release
   npm run desktop:build

   # Sign the macOS bundle, for example
   cargo tauri signer sign \
     --private-key ~/.tauri/selah.key \
     src-tauri/target/release/bundle/macos/Selah.app.tar.gz

   # Copy both files into the project root
   cp src-tauri/target/release/bundle/macos/Selah.app.tar.gz .
   cp src-tauri/target/release/bundle/macos/Selah.app.tar.gz.sig .

   # Edit latest.json: paste the .sig contents into the matching
   # platform's `signature` field (include the comment header).
   ```

## Production cut-over

When you're ready to ship to real users:

1. **Generate the updater keypair** (free, ~5 min):

   ```bash
   cargo tauri signer generate -w ~/.tauri/selah.key
   ```

   - `~/.tauri/selah.key` (private) — store in **GitHub Actions
     secrets** as `TAURI_SIGNING_PRIVATE_KEY`. **Never commit.**
   - `~/.tauri/selah.key.pub` (public) — paste into
     `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.

2. **Flip these flags in `src-tauri/tauri.conf.json`**:

   ```json
   {
     "bundle": {
       "createUpdaterArtifacts": true   // ← flip to true
     },
     "plugins": {
       "updater": {
         "endpoints": [
           "https://github.com/danteata/selah/releases/latest/download/latest.json"
         ],
         "pubkey": "<paste .pub contents here>",
         "dangerousInsecureTransportProtocol": false   // ← flip to false
       }
     }
   }
   ```

3. **The `tauri-apps/tauri-action@v0` already in your build workflow**
   (`build-desktop.yml`) will:
   - Read `TAURI_SIGNING_PRIVATE_KEY` from the GitHub secret.
   - Sign every platform bundle.
   - Upload `.app.tar.gz`, `.app.tar.gz.sig`, `.nsis.zip`,
     `.nsis.zip.sig`, `.msi.zip`, `.msi.zip.sig`, `.AppImage.tar.gz`,
     `.deb`, `.rpm` as release assets.
   - Generate and upload `latest.json` automatically.

4. **Cut a release tag**:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

   The workflow builds, signs, and publishes. Users on v0.1.0 get
   auto-updated on next launch (or via Settings → Updates).

## OS-level code signing (deferred)

For polished distribution, you also need code-signing certificates
on each platform. These cost money and time, and you can ship
without them for v1.

| Platform | Cert | Cost | Without it |
|---|---|---|---|
| **macOS** | Apple Developer ID ($99/yr) | First-launch warnings; `.pkg` updates may fail |
| **Windows** | Authenticode cert (~$70-500/yr) | SmartScreen warnings |
| **Linux** | GPG key (free) | Not required for AppImage / direct download |

When you're ready to add these, set the additional env vars on
`tauri-action` (per the Tauri docs) and add the matching bundle
config to `tauri.conf.json`. **Do not** remove the Tauri updater
signing — that one must stay regardless of OS certs.

## Operational notes

- **The public key in `tauri.conf.json` is bound forever.** If you
  lose the private key, no future version can self-update. Back it
  up in two secure locations (1Password + encrypted USB).
- **Signature failures are silent kills** — the user sees "could
  not verify update" but their existing version keeps working.
- **Rollback**: keep the prior `latest.json` accessible. If v0.2.0
  is broken, publish v0.2.1 or rename v0.1.0's `latest.json` over
  the top (the signature was already generated for it).
- **No telemetry in v1** — consider adding Sentry before you ship
  auto-updates so you know immediately when an update breaks.
