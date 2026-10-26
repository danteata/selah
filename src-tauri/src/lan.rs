//! The desk on the local network: it announces itself over mDNS so the phone
//! app finds it on the same Wi-Fi without anyone typing an address, and
//! listens for those phones on `LAN_PORT` (see crates/selah-lan). The live
//! session itself is the frontend's (src/services/lan/host.ts): this side
//! carries its messages and decides which phones may connect.

use parking_lot::Mutex;
use selah_lan::{Announcement, DeviceSummary, Host, HostEvent, Pairings};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

/// Where the desk listens for phones.
pub const LAN_PORT: u16 = 17494;

/// The event every link happening reaches the frontend on.
const HOST_EVENT: &str = "lan-host";

#[derive(Default)]
pub struct LanState {
    announcement: Mutex<Option<Announcement>>,
    /// The church the announcement is for, so a repeat start doesn't
    /// re-announce for nothing.
    announced_for: Mutex<Option<String>>,
    host: Mutex<Option<Host>>,
}

/// This computer's name as people know it, for the desk's name on the network.
fn computer_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| "Selah desk".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanStatus {
    desk_id: String,
    name: String,
    port: u16,
    /// This computer's addresses, for connecting a phone by hand.
    addresses: Vec<String>,
}

/// Listen for phones and announce the desk, for `church_id` when it's known.
/// Without one (signed in while Convex was unreachable, before the church
/// was ever cached) the desk still announces; phones of any church see it,
/// and pairing is what keeps strangers out. Safe to call again: it only
/// re-announces when the church changes.
#[tauri::command]
pub async fn lan_start(
    app: AppHandle,
    state: State<'_, LanState>,
    church_id: Option<String>,
    name: Option<String>,
) -> Result<LanStatus, String> {
    let name = name.filter(|n| !n.trim().is_empty()).unwrap_or_else(computer_name);

    if state.host.lock().is_none() {
        let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
        let pairings = Pairings::load(dir.join("lan-devices.json"));
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<HostEvent>();
        let host = Host::start(LAN_PORT, name.clone(), pairings, tx)
            .await
            .map_err(|e| format!("Couldn't listen for phones on port {LAN_PORT}: {e}"))?;
        let events = app.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                let _ = events.emit(HOST_EVENT, &event);
            }
        });
        let mut slot = state.host.lock();
        if slot.is_none() {
            *slot = Some(host);
        }
        // Otherwise another start won the race, and this host drops here.
    }

    let desk_id = state.host.lock().as_ref().map(Host::desk_id).unwrap_or_default();
    let church = church_id.filter(|c| !c.trim().is_empty());
    let needs_announcing = state.announcement.lock().is_none() || *state.announced_for.lock() != church;
    if needs_announcing {
        let version = env!("CARGO_PKG_VERSION");
        let mut properties = vec![("id", desk_id.as_str()), ("v", version)];
        if let Some(church) = &church {
            properties.push(("church", church.as_str()));
        }
        // The old announcement says goodbye first.
        *state.announcement.lock() = None;
        let announcement = selah_lan::announce(&name, LAN_PORT, &properties).map_err(|e| e.to_string())?;
        *state.announcement.lock() = Some(announcement);
        *state.announced_for.lock() = church;
    }

    Ok(LanStatus { desk_id, name, port: LAN_PORT, addresses: selah_lan::local_addresses() })
}

/// Take the desk off the network and disconnect every phone (signing out).
#[tauri::command]
pub fn lan_stop(state: State<'_, LanState>) {
    *state.announcement.lock() = None;
    *state.announced_for.lock() = None;
    *state.host.lock() = None;
}

/// Send one phone a message. False if it has gone.
#[tauri::command]
pub fn lan_send(state: State<'_, LanState>, client: u64, text: String) -> bool {
    state.host.lock().as_ref().map(|host| host.send(client, text)).unwrap_or(false)
}

/// Send every connected phone a message.
#[tauri::command]
pub fn lan_broadcast(state: State<'_, LanState>, text: String) {
    if let Some(host) = state.host.lock().as_ref() {
        host.broadcast(&text);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingCode {
    code: String,
    expires_in_ms: u64,
}

/// Show a pairing code: for the next two minutes, a phone that sends it is
/// trusted from then on.
#[tauri::command]
pub fn lan_pair_begin(state: State<'_, LanState>) -> Result<PairingCode, String> {
    let host = state.host.lock();
    let host = host.as_ref().ok_or("The desk isn't listening for phones.")?;
    Ok(PairingCode { code: host.begin_pairing(), expires_in_ms: selah_lan::PAIRING_WINDOW.as_millis() as u64 })
}

#[tauri::command]
pub fn lan_pair_end(state: State<'_, LanState>) {
    if let Some(host) = state.host.lock().as_ref() {
        host.end_pairing();
    }
}

/// The phones this desk trusts.
#[tauri::command]
pub fn lan_devices(state: State<'_, LanState>) -> Vec<DeviceSummary> {
    state.host.lock().as_ref().map(Host::devices).unwrap_or_default()
}

/// Stop trusting a phone (and disconnect it).
#[tauri::command]
pub fn lan_forget(state: State<'_, LanState>, device_id: String) -> bool {
    state.host.lock().as_ref().map(|host| host.forget(&device_id)).unwrap_or(false)
}
