use std::net::{IpAddr, SocketAddr};
use std::sync::Mutex;
use std::time::Duration;

use selah_lan::{Auth, Connected, Desk, Link, LinkError, LinkEvent};
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{AppHandle, Emitter, Runtime, State};

/// Look for Selah desks on this Wi-Fi for up to `timeout_ms` (capped at 10s).
/// Runs off the main thread: mDNS waits on the network.
#[tauri::command]
async fn discover_desks(timeout_ms: Option<u64>) -> Result<Vec<Desk>, String> {
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(3000).min(10_000));
    tauri::async_runtime::spawn_blocking(move || selah_lan::discover(timeout))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// The phone's link to a desk, while there is one, and a count of links so
/// far: events carry their link's number, so the frontend can tell a link it
/// just replaced closing from the one it has now.
#[derive(Default)]
struct LinkState(Mutex<(Option<Link>, u64)>);

/// The event the desk's messages reach the frontend on: `{link, message}`
/// for each one, `{link, closed}` once when the link goes.
const LINK_EVENT: &str = "lan-link";

#[derive(serde::Serialize)]
struct LinkOpened {
    link: u64,
    #[serde(flatten)]
    connected: Connected,
}

/// Connect to the desk at one of `addresses` (tried in order; a desk on
/// several networks lists them all), proving this phone with its `token`
/// from an earlier pairing or the `code` on the desk's screen. Replaces any
/// link already open. Errors start with "unreachable:", "denied:" (then
/// "unpaired", "code" or "not-pairing") or "protocol:".
#[tauri::command]
async fn lan_connect(
    app: AppHandle,
    state: State<'_, LinkState>,
    addresses: Vec<String>,
    port: u16,
    device: serde_json::Value,
    user: serde_json::Value,
    token: Option<String>,
    code: Option<String>,
) -> Result<LinkOpened, String> {
    let auth = match (token, code) {
        (_, Some(code)) => Auth::Code(code),
        (Some(token), None) => Auth::Token(token),
        (None, None) => return Err(LinkError::Denied("unpaired".into()).to_string()),
    };
    let link_id = {
        let mut slot = state.0.lock().unwrap();
        slot.0 = None;
        slot.1 += 1;
        slot.1
    };

    let mut last = LinkError::Unreachable("no address for the desk".into());
    for address in &addresses {
        let Ok(ip) = address.parse::<IpAddr>() else { continue };
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<LinkEvent>();
        match Link::connect(SocketAddr::new(ip, port), device.clone(), user.clone(), auth.clone(), tx).await {
            Ok((link, connected)) => {
                let events = app.clone();
                tauri::async_runtime::spawn(async move {
                    while let Some(event) = rx.recv().await {
                        let payload = match event {
                            LinkEvent::Message(text) => serde_json::json!({ "link": link_id, "message": text }),
                            LinkEvent::Closed(reason) => serde_json::json!({ "link": link_id, "closed": reason }),
                        };
                        let _ = events.emit(LINK_EVENT, payload);
                    }
                });
                let mut slot = state.0.lock().unwrap();
                // A newer connect started meanwhile: it wins, and this link drops.
                if slot.1 == link_id {
                    slot.0 = Some(link);
                }
                return Ok(LinkOpened { link: link_id, connected });
            }
            // The desk answered and said no: another address won't change that.
            Err(e @ (LinkError::Denied(_) | LinkError::Protocol(_))) => return Err(e.to_string()),
            Err(e) => last = e,
        }
    }
    Err(last.to_string())
}

/// Send the desk a message. False when there's no link.
#[tauri::command]
fn lan_link_send(state: State<'_, LinkState>, text: String) -> bool {
    state.0.lock().unwrap().0.as_ref().map(|link| link.send(text)).unwrap_or(false)
}

#[tauri::command]
fn lan_disconnect(state: State<'_, LinkState>) {
    state.0.lock().unwrap().0 = None;
}

/// Android's speech recognizer (SpeechPlugin.kt), for voice search: the web
/// view has no Web Speech.
#[cfg(target_os = "android")]
struct Speech<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(target_os = "android")]
#[derive(serde::Deserialize)]
struct Heard {
    text: String,
}

/// Listen for one phrase and return what was said ("" when nothing was).
#[tauri::command]
async fn speech_listen<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let speech = app.state::<Speech<R>>().0.clone();
        let heard = tauri::async_runtime::spawn_blocking(move || speech.run_mobile_plugin::<Heard>("listen", ()))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
        Ok(heard.text)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("Voice search here uses the browser's speech recognition.".into())
    }
}

/// Stop listening early; `speech_listen` then returns what was heard.
#[tauri::command]
async fn speech_stop<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let speech = app.state::<Speech<R>>().0.clone();
        tauri::async_runtime::spawn_blocking(move || speech.run_mobile_plugin::<()>("stop", ()))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

fn speech_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("speech")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin("app.selah.mobile", "SpeechPlugin")?;
                _app.manage(Speech(handle));
            }
            Ok(())
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(speech_plugin())
        .manage(LinkState::default())
        .invoke_handler(tauri::generate_handler![
            discover_desks,
            lan_connect,
            lan_link_send,
            lan_disconnect,
            speech_listen,
            speech_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running Selah");
}
