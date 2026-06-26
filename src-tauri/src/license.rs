//! Offline license verification.
//!
//! Selah's entitlements are gated by an Ed25519-signed license file issued by
//! the Convex backend (`convex/licensing.ts`). The app verifies that file fully
//! offline against a public key baked in at build time, so premium features keep
//! working on a plane, behind a captive portal, or while our server is down.
//!
//! The license file ships the *exact bytes* that were signed (base64 in
//! `payload_b64`); we verify the signature over those bytes and only then parse
//! the JSON. That removes any canonical-JSON ambiguity between server and client.
//!
//! Trust anchor: the public key. Provide it at build time via
//! `SELAH_LICENSE_PUBLIC_KEY_HEX`, or fall back to the baked dev key below. The
//! private signing key lives only on the Convex deployment.
//!
//! Anti-rollback: a user could try to extend the offline grace window forever by
//! setting their system clock back. We persist the highest timestamp we've ever
//! observed (`max_seen`) and evaluate expiry against `max(now, max_seen)`, so a
//! clock that moves backwards can't buy extra time.

use std::fs;
use std::path::PathBuf;

use base64::Engine;
use chrono::{DateTime, Duration, Utc};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use tauri::Manager;

/// Dev/default public key (matches the dev seed documented for
/// `LICENSE_SIGNING_KEY`). Override for production via the
/// `SELAH_LICENSE_PUBLIC_KEY_HEX` build-time env var.
const DEV_PUBLIC_KEY_HEX: &str =
    "d8311ed692c1b220c5437259fba31e926da1d60c4e052a763092972db4a277f7";

/// Public keys this build trusts, keyed by `key_id`. Add a second entry during a
/// key rotation so both old and new licenses verify until everyone has refreshed.
fn public_key_for(key_id: &str) -> Option<[u8; 32]> {
    let configured = option_env!("SELAH_LICENSE_PUBLIC_KEY_HEX");
    let hex = match key_id {
        // The active key. CI can inject the production key via env.
        "k1" => configured.unwrap_or(DEV_PUBLIC_KEY_HEX),
        _ => return None,
    };
    decode_hex_32(hex)
}

fn decode_hex_32(hex: &str) -> Option<[u8; 32]> {
    let hex = hex.trim();
    if hex.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

// --- wire types -------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct LicenseFile {
    #[allow(dead_code)]
    alg: String,
    key_id: String,
    payload_b64: String,
    signature: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct LicensePayload {
    v: u32,
    key_id: String,
    license_id: String,
    user_id: String,
    email: String,
    plan: String,
    status: String,
    issued_at: String,
    expires_at: Option<String>,
    grace_period_days: i64,
}

/// What the frontend needs to gate UI. Returned by every command here.
#[derive(Debug, Clone, Serialize, Default)]
pub struct LicenseStatus {
    /// Signature verified and payload parsed cleanly.
    pub valid: bool,
    /// "free" | "pro" — the plan the (verified) license grants.
    pub plan: String,
    /// Subscription status string echoed from the server (informational).
    pub status: String,
    /// True when the user is currently entitled to `plan` (Pro inside grace).
    pub entitled: bool,
    /// True when past `expires_at` but still inside the grace window.
    pub in_grace: bool,
    pub email: String,
    pub expires_at: Option<String>,
    /// `expires_at` + grace, i.e. the hard cutoff (None for free).
    pub grace_until: Option<String>,
    /// Human-readable explanation for logs / debugging UI.
    pub reason: String,
}

impl LicenseStatus {
    /// Status used when there is no license on disk yet: free tier, usable.
    fn free_default(reason: &str) -> Self {
        LicenseStatus {
            valid: false,
            plan: "free".into(),
            status: "none".into(),
            entitled: false,
            in_grace: false,
            email: String::new(),
            expires_at: None,
            grace_until: None,
            reason: reason.into(),
        }
    }
}

// --- paths ------------------------------------------------------------------

fn license_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("license.json"))
}

fn state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("license_state.json"))
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct AntiRollbackState {
    /// Highest timestamp (ISO 8601) ever observed — wall clock or `issued_at`.
    max_seen: Option<String>,
}

fn read_max_seen(app: &tauri::AppHandle) -> Option<DateTime<Utc>> {
    let raw = fs::read_to_string(state_path(app).ok()?).ok()?;
    let state: AntiRollbackState = serde_json::from_str(&raw).ok()?;
    parse_ts(state.max_seen.as_deref()?)
}

fn write_max_seen(app: &tauri::AppHandle, ts: DateTime<Utc>) {
    if let Ok(path) = state_path(app) {
        let state = AntiRollbackState {
            max_seen: Some(ts.to_rfc3339()),
        };
        if let Ok(json) = serde_json::to_string(&state) {
            let _ = fs::write(path, json);
        }
    }
}

fn parse_ts(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

// --- verification -----------------------------------------------------------

/// Verify the signature and return the parsed payload, or an error string.
fn verify(file: &LicenseFile) -> Result<LicensePayload, String> {
    let pk = public_key_for(&file.key_id).ok_or_else(|| format!("untrusted key_id: {}", file.key_id))?;
    let vk = VerifyingKey::from_bytes(&pk).map_err(|e| format!("bad public key: {e}"))?;

    let payload_bytes = base64::engine::general_purpose::STANDARD
        .decode(file.payload_b64.as_bytes())
        .map_err(|e| format!("bad payload_b64: {e}"))?;
    let sig_bytes = base64::engine::general_purpose::STANDARD
        .decode(file.signature.as_bytes())
        .map_err(|e| format!("bad signature b64: {e}"))?;
    let sig = Signature::from_slice(&sig_bytes).map_err(|e| format!("bad signature: {e}"))?;

    vk.verify_strict(&payload_bytes, &sig)
        .map_err(|_| "signature verification failed".to_string())?;

    let payload: LicensePayload =
        serde_json::from_slice(&payload_bytes).map_err(|e| format!("bad payload json: {e}"))?;

    // The signed payload must claim the same key that signed the file.
    if payload.key_id != file.key_id {
        return Err("key_id mismatch between file and payload".into());
    }
    Ok(payload)
}

/// Turn a verified payload into a status, applying expiry + grace + anti-rollback.
fn evaluate(app: &tauri::AppHandle, payload: LicensePayload) -> LicenseStatus {
    let wall_now = Utc::now();
    // Effective "now" can never move below the highest timestamp we've seen.
    let issued = parse_ts(&payload.issued_at);
    let max_seen = read_max_seen(app);
    let effective_now = [Some(wall_now), max_seen, issued]
        .into_iter()
        .flatten()
        .max()
        .unwrap_or(wall_now);

    // Persist the new high-water mark for next launch.
    write_max_seen(app, effective_now);

    // Free plan: always valid, no expiry, but never grants Pro.
    if payload.plan != "pro" {
        return LicenseStatus {
            valid: true,
            plan: payload.plan,
            status: payload.status,
            entitled: false,
            in_grace: false,
            email: payload.email,
            expires_at: None,
            grace_until: None,
            reason: "free plan".into(),
        };
    }

    // Pro plan: must be within expiry + grace.
    let expires = payload.expires_at.as_deref().and_then(parse_ts);
    let (entitled, in_grace, grace_until, reason) = match expires {
        None => (true, false, None, "pro, no expiry".to_string()),
        Some(exp) => {
            let cutoff = exp + Duration::days(payload.grace_period_days.max(0));
            let entitled = effective_now < cutoff;
            let in_grace = effective_now >= exp && entitled;
            let reason = if !entitled {
                "pro expired (past grace)".to_string()
            } else if in_grace {
                "pro in grace period".to_string()
            } else {
                "pro active".to_string()
            };
            (entitled, in_grace, Some(cutoff.to_rfc3339()), reason)
        }
    };

    LicenseStatus {
        valid: true,
        plan: payload.plan,
        status: payload.status,
        entitled,
        in_grace,
        email: payload.email,
        expires_at: payload.expires_at,
        grace_until,
        reason,
    }
}

fn evaluate_raw(app: &tauri::AppHandle, raw: &str) -> LicenseStatus {
    let file: LicenseFile = match serde_json::from_str(raw) {
        Ok(f) => f,
        Err(e) => return LicenseStatus::free_default(&format!("malformed license file: {e}")),
    };
    match verify(&file) {
        Ok(payload) => evaluate(app, payload),
        Err(e) => LicenseStatus::free_default(&format!("invalid license: {e}")),
    }
}

// --- Tauri commands ---------------------------------------------------------

/// Read and evaluate the license currently stored on disk. Returns a free-tier
/// status (not an error) when no valid license is present.
#[tauri::command]
pub fn get_license_status(app: tauri::AppHandle) -> Result<LicenseStatus, String> {
    let path = license_path(&app)?;
    let raw = match fs::read_to_string(&path) {
        Ok(r) => r,
        Err(_) => return Ok(LicenseStatus::free_default("no license on disk")),
    };
    Ok(evaluate_raw(&app, &raw))
}

/// Validate a license file (string JSON) and, if its signature checks out,
/// persist it and return the evaluated status. Rejects invalid licenses without
/// touching the stored one.
#[tauri::command]
pub fn save_license(app: tauri::AppHandle, license_json: String) -> Result<LicenseStatus, String> {
    let file: LicenseFile =
        serde_json::from_str(&license_json).map_err(|e| format!("malformed license file: {e}"))?;
    let payload = verify(&file)?; // hard error so callers know it was rejected
    fs::write(license_path(&app)?, &license_json).map_err(|e| e.to_string())?;
    Ok(evaluate(&app, payload))
}

/// Delete the stored license (e.g. on sign-out). Leaves the anti-rollback
/// high-water mark in place on purpose.
#[tauri::command]
pub fn clear_license(app: tauri::AppHandle) -> Result<(), String> {
    let path = license_path(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Fetch a fresh license from the Convex `/license` endpoint and store it.
///
/// `convex_site_url` is the deployment's `.site` origin; `token` is the user's
/// Clerk JWT (the frontend gets it from `useAuth().getToken()`). On any network
/// failure we fall back to whatever is cached — that offline tolerance is the
/// whole point of signed licenses.
#[tauri::command]
pub async fn fetch_and_store_license(
    app: tauri::AppHandle,
    convex_site_url: String,
    token: String,
) -> Result<LicenseStatus, String> {
    let url = format!("{}/license", convex_site_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .bearer_auth(token)
        .send()
        .await;

    match resp {
        Ok(r) if r.status().is_success() => {
            let body = r.text().await.map_err(|e| e.to_string())?;
            // save_license validates the signature before persisting.
            save_license(app, body)
        }
        Ok(r) => {
            // Server reachable but refused (e.g. 401) — keep the cached license.
            let code = r.status();
            let cached = get_license_status(app)?;
            Ok(LicenseStatus {
                reason: format!("license refresh failed ({code}); using cached"),
                ..cached
            })
        }
        Err(e) => {
            // Offline / unreachable — keep the cached license silently.
            let cached = get_license_status(app)?;
            Ok(LicenseStatus {
                reason: format!("offline ({e}); using cached"),
                ..cached
            })
        }
    }
}
