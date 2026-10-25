use std::time::Duration;

use selah_lan::Desk;
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{AppHandle, Runtime};

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
        .invoke_handler(tauri::generate_handler![discover_desks, speech_listen, speech_stop])
        .run(tauri::generate_context!())
        .expect("error while running Selah");
}
