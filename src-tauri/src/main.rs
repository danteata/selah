// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Embed the macOS Info.plist into the binary so NSMicrophoneUsageDescription
// and NSSpeechRecognitionUsageDescription are present in the final
// Contents/Info.plist. Without these, the WebKit speech recognition
// TCC check SIGABRTs the host app the first time the user clicks the
// mic, and getUserMedia is silently denied.
//
// Tauri 2.x's codegen calls `embed_info_plist!` automatically for
// `src-tauri/Info.plist` only when feature "custom-protocol" is
// OFF (see tauri-codegen context.rs:
// `dev: cfg!(not(feature = "custom-protocol"))`, and the embed is
// gated on `target == MacOS && dev && !running_tests`).
//
// In any build with `custom-protocol` enabled — which is the default
// in Cargo.toml, and is always enabled by `tauri build` for release
// bundling — codegen skips the embed, and Tauri's bundler writes a
// fresh Info.plist from tauri.conf.json that drops our custom keys.
// We therefore manually call the macro when custom-protocol IS
// enabled, and rely on the codegen auto-embed when it is OFF (i.e.
// `tauri dev`). This split avoids the link-time
// "symbol `_EMBED_INFO_PLIST` already defined" error that would
// come from double-embedding in `tauri dev`.
//
// Verify after every Tauri upgrade:
//   plutil -p path/to/Selah.app/Contents/Info.plist | grep -E "Microphone|Speech"
#[cfg(all(target_os = "macos", feature = "custom-protocol"))]
tauri::embed_plist::embed_info_plist!(concat!(env!("CARGO_MANIFEST_DIR"), "/Info.plist"));

mod audio_capture;
mod license;
mod logging;
mod multi_monitor;
mod ndi_output;
mod oauth_listener;
mod platform;
// Model catalog/downloader always compiles; the transcribe-rs engine inside is
// gated behind the `native-transcription` feature.
mod transcription;

use std::sync::Arc;
use tauri::{Emitter, Manager, WindowEvent};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_updater::UpdaterExt;
use tracing::info;

use crate::oauth_listener::start_oauth_listener;

use license::{
    get_license_status,
    save_license,
    clear_license,
    fetch_and_store_license,
};

use audio_capture::{
    AudioCaptureState,
    list_audio_devices,
    is_system_audio_supported,
    check_screen_capture_permission,
    request_screen_capture_permission,
    open_screen_capture_settings,
    start_capture,
    start_capture_with_vad,
    init_vad,
    set_vad_enabled,
    stop_capture,
    is_capturing,
    get_audio_chunk,
    get_buffer_size,
    flush_buffer,
    clear_buffer,
    get_capture_type,
    get_audio_chunk_as_wav,
    flush_buffer_as_wav,
    start_session_recording,
    stop_session_recording,
};

use multi_monitor::{
    MultiMonitorState,
    get_monitors,
    get_primary_monitor,
    get_best_live_monitor,
    open_live_window,
    close_live_window,
    toggle_live_fullscreen,
    move_live_to_monitor,
    get_live_window_state,
    is_live_window_open,
    get_current_live_monitor,
    send_slide_to_live,
    send_settings_to_live,
    clear_live_output,
    get_window_state,
    save_window_state,
    update_main_window_state,
    restore_main_window_state,
    is_desktop,
    identify_monitor,
    LIVE_WINDOW_LABEL,
};

use ndi_output::{
    NdiManager,
    ndi_is_available,
    ndi_is_supported,
    ndi_get_state,
    ndi_start_output,
    ndi_stop_output,
    ndi_send_video_frame,
    ndi_send_audio_frame,
    ndi_discover_sources,
};

use logging::{
    init_logging,
    log_message,
    get_logs,
    check_previous_crash,
    cleanup_old_logs,
};

use transcription::commands::{
    list_native_models,
    download_native_model,
    cancel_native_download,
    is_native_model_downloaded,
    delete_native_model,
    load_native_model,
    unload_native_model,
    get_loaded_native_model,
    set_native_transcription_config,
    transcribe_audio_file,
    llm_proxy,
};
use transcription::ModelManager;


/// What an available update is, as far as the UI needs to know.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    /// The version on offer, e.g. "0.1.10".
    version: String,
    /// The version currently running.
    current_version: String,
    /// Release notes from the update manifest, if the release supplied any.
    notes: Option<String>,
    /// Publish date, ISO 8601.
    date: Option<String>,
}

/// Check whether an update exists, and report it — without installing anything.
///
/// Checking and installing used to be one command: it downloaded, installed and
/// restarted the moment it found a new version. That made an update impossible
/// to announce (there was nothing to announce it *before*) and meant the silent
/// check five seconds after launch could restart the app on its own — including
/// in the middle of a service. Installing is now `install_update`, called only
/// when the operator asks for it.
///
/// Errors are returned as strings so a frontend `try/catch` is enough.
#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;

    Ok(update.map(|update| UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
        date: update.date.map(|date| date.to_string()),
    }))
}

/// Download and install the available update, then restart into it.
///
/// The two closures passed to `download_and_install` are progress callbacks
/// (downloaded-bytes, content-length). They are no-ops here; the frontend
/// listens for `tauri://update-download-progress` to drive its progress bar.
///
/// Re-checks rather than taking an `Update` from the caller, because the check
/// result isn't `Send` across the command boundary and the manifest fetch is
/// cheap next to the download.
///
/// On Windows the updater spawns the installer and calls `exit(0)` itself, so
/// nothing after `download_and_install` runs there. Elsewhere `app.restart()`
/// replaces the running process with the new binary; it never returns.
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Err("No update is available.".into());
    };

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    app.restart()
}

/// Bring the main window to the foreground (used by the tray).
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Build the system tray icon + menu. The menu lets the operator bring Selah to
/// the front, toggle the sermon listener, and quit — without hunting for the
/// window. "Toggle listening" is emitted as an event the frontend handles,
/// since the listening pipeline lives in the React layer.
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_i = MenuItemBuilder::with_id("show", "Show Selah").build(app)?;
    let toggle_i = MenuItemBuilder::with_id("toggle_listening", "Start / Stop Listening").build(app)?;
    let quit_i = MenuItemBuilder::with_id("quit", "Quit Selah").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show_i, &toggle_i])
        .separator()
        .items(&[&quit_i])
        .build()?;

    let mut builder = TrayIconBuilder::with_id("selah-tray")
        .tooltip("Selah")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "toggle_listening" => {
                let _ = app.emit("tray://toggle-listening", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Left-click the tray icon to reveal the window (common convention).
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    // Reuse the app's bundled window icon for the tray.
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let multi_monitor_state: Arc<MultiMonitorState> = Arc::new(MultiMonitorState::new());
    let ndi_manager: Arc<NdiManager> = Arc::new(NdiManager::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AudioCaptureState::new())
        .manage(multi_monitor_state.clone())
        .manage(ndi_manager.clone())
        .invoke_handler(tauri::generate_handler![
            list_audio_devices,
            is_system_audio_supported,
            check_screen_capture_permission,
            request_screen_capture_permission,
            open_screen_capture_settings,
            start_capture,
            start_capture_with_vad,
            init_vad,
            set_vad_enabled,
            stop_capture,
            is_capturing,
            get_audio_chunk,
            get_buffer_size,
            flush_buffer,
            clear_buffer,
            get_capture_type,
            get_audio_chunk_as_wav,
            flush_buffer_as_wav,
            start_session_recording,
            stop_session_recording,
            get_monitors,
            get_primary_monitor,
            get_best_live_monitor,
            open_live_window,
            close_live_window,
            toggle_live_fullscreen,
            move_live_to_monitor,
            get_live_window_state,
            is_live_window_open,
            get_current_live_monitor,
            send_slide_to_live,
            send_settings_to_live,
            clear_live_output,
            get_window_state,
            save_window_state,
            update_main_window_state,
            restore_main_window_state,
            is_desktop,
            identify_monitor,
            ndi_is_available,
            ndi_is_supported,
            ndi_get_state,
            ndi_start_output,
            ndi_stop_output,
            ndi_send_video_frame,
            ndi_send_audio_frame,
            ndi_discover_sources,
            log_message,
            get_logs,
            check_previous_crash,
            check_update,
            install_update,
            start_oauth_listener,
            list_native_models,
            download_native_model,
            cancel_native_download,
            is_native_model_downloaded,
            delete_native_model,
            load_native_model,
            unload_native_model,
            get_loaded_native_model,
            set_native_transcription_config,
            transcribe_audio_file,
            llm_proxy,
            get_license_status,
            save_license,
            clear_license,
            fetch_and_store_license,
        ])
        .setup(move |app| {
            // Initialize file logging and crash detection
            let app_config_dir = app.path().app_config_dir()
                .expect("Failed to get app config dir");
            std::fs::create_dir_all(&app_config_dir)
                .unwrap_or_else(|e| eprintln!("[main] Failed to create config dir: {}", e));
            
            // Check for previous crash before initializing the sentinel
            let crashed = logging::check_crash_detection(&app_config_dir);
            if crashed == Some(true) {
                eprintln!("[main] Previous session crashed — crash detected via sentinel file");
            }
            
            let (sentinel_guard, log_state) = init_logging(&app_config_dir);
            
            info!("[main] Selah starting — config dir: {:?}", app_config_dir);
            
            // Clean up old log files (keep last 7 days)
            cleanup_old_logs(&log_state.log_dir, 7);
            
            // Store log state for the get_logs command
            app.manage(log_state);
            
            // Leak the sentinel guard so it persists until process exit.
            // On clean shutdown, the guard's Drop impl removes the sentinel file.
            // On crash, the file remains and is detected on next launch.
            std::mem::forget(sentinel_guard);

            multi_monitor_state.init(app.handle().clone());
            ndi_manager.init(app.handle().clone());

            // Native transcription model store (Whisper GGUF + Parakeet ONNX).
            // Downloaded models live under the app data dir; the bundled offline
            // model can be seeded here later.
            if let Ok(data_dir) = app.path().app_data_dir() {
                let models_dir = data_dir.join("transcription-models");
                let model_manager = std::sync::Arc::new(ModelManager::new(models_dir));
                // Seed the bundled GGUF base.en so native transcription works offline.
                if let Ok(res) = app.path().resource_dir() {
                    model_manager.seed_bundled(&res.join("assets").join("whisper-models-gguf"));
                }
                app.manage(model_manager);
            }

            // In-process transcription engine (Whisper/Parakeet via transcribe-rs,
            // Whisper-family + streaming GGUF models via transcribe-cpp).
            #[cfg(feature = "native-transcription")]
            {
                transcription::engine::init_transcribe_cpp_backend();
                transcription::engine::apply_default_accelerators();
                app.manage(transcription::TranscriptionManager::new(app.handle()));
            }

            // Tear down the live output window when the main window closes.
            // The live output is a separate webview window; Tauri only exits
            // once ALL windows are closed, so without this a still-open live
            // output would keep the process (and the projected output) alive
            // after the user "quit" by closing the main window — the classic
            // stuck-live-output-after-quit symptom.
            if let Some(main_window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                main_window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { .. } = event {
                        if let Some(live) = app_handle.get_webview_window(LIVE_WINDOW_LABEL) {
                            let _ = live.close();
                        }
                    }
                });
            }

            // System tray (start/stop listening, show window, quit).
            if let Err(e) = setup_tray(app) {
                eprintln!("[main] Failed to set up system tray: {}", e);
            }

            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run()
}