//! The desk on the local network: it announces itself over mDNS so the phone
//! app finds it on the same Wi-Fi without anyone typing an address (see
//! crates/selah-lan). Discovery only so far; the port is where the desk's
//! local session server will listen.

use parking_lot::Mutex;
use selah_lan::Announcement;
use tauri::State;

/// Where the local session server will listen.
pub const LAN_PORT: u16 = 17494;

#[derive(Default)]
pub struct LanState(Mutex<Option<Announcement>>);

/// This computer's name as people know it, for the desk's name on the network.
fn computer_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| "Selah desk".to_string())
}

/// Announce this desk for `church_id` (replacing any earlier announcement).
#[tauri::command]
pub fn lan_announce(state: State<'_, LanState>, church_id: String, name: Option<String>) -> Result<String, String> {
    let name = name.filter(|n| !n.trim().is_empty()).unwrap_or_else(computer_name);
    let version = env!("CARGO_PKG_VERSION");
    let mut current = state.0.lock();
    *current = None; // the old announcement says goodbye first
    let announcement = selah_lan::announce(&name, LAN_PORT, &[("church", church_id.as_str()), ("v", version)])
        .map_err(|e| e.to_string())?;
    let fullname = announcement.fullname().to_string();
    *current = Some(announcement);
    Ok(fullname)
}

/// Take the desk off the network (signing out, or another church).
#[tauri::command]
pub fn lan_stop(state: State<'_, LanState>) {
    *state.0.lock() = None;
}
