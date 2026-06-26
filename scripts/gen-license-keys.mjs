#!/usr/bin/env node
/**
 * gen-license-keys.mjs — generate an Ed25519 keypair for offline license signing.
 *
 * The PRIVATE seed lives ONLY on the server (Convex):
 *   npx convex env set LICENSE_SIGNING_KEY <seed-hex>
 *
 * The PUBLIC key is baked into the Tauri app so it can verify licenses fully
 * offline. Either paste the printed Rust array into `src-tauri/src/license.rs`,
 * or inject it at build time:
 *   export SELAH_LICENSE_PUBLIC_KEY_HEX=<pub-hex>   # read by license.rs via option_env!
 *
 * Usage:
 *   node scripts/gen-license-keys.mjs
 *
 * Rotate keys by generating a new pair, bumping LICENSE_KEY_ID in convex/licensing.ts,
 * and shipping an app build that trusts both the old and new public keys.
 */

import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'

// @noble/ed25519 v3 needs the sync SHA-512 wired up for the synchronous API.
ed.hashes.sha512 = sha512

const seed = ed.utils.randomSecretKey()
const publicKey = ed.getPublicKey(seed)

const seedHex = ed.etc.bytesToHex(seed)
const pubHex = ed.etc.bytesToHex(publicKey)

const rustArray = Array.from(publicKey)
    .map((b) => `0x${b.toString(16).padStart(2, '0')}`)
    .reduce((rows, hex, i) => {
        const row = Math.floor(i / 8)
        rows[row] = rows[row] ? `${rows[row]} ${hex},` : `    ${hex},`
        return rows
    }, [])
    .join('\n')

console.log(`
Ed25519 license keypair generated.

1. Server (Convex) — keep this secret, never commit it:

   npx convex env set LICENSE_SIGNING_KEY ${seedHex}

2. Client (Tauri) — bake the public key into the app. Option A, env at build time:

   export SELAH_LICENSE_PUBLIC_KEY_HEX=${pubHex}

   Option B, paste into src-tauri/src/license.rs (PUBLIC_KEY_BYTES):

const PUBLIC_KEY_BYTES: [u8; 32] = [
${rustArray}
];

Public key (hex):  ${pubHex}
`)
