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
mod logging;
mod multi_monitor;
mod ndi_output;
mod oauth_listener;

use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::UpdaterExt;
use tracing::info;

use crate::oauth_listener::start_oauth_listener;

use audio_capture::{
    AudioCaptureState,
    list_audio_devices,
    is_system_audio_supported,
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
    clear_live_output,
    get_window_state,
    save_window_state,
    update_main_window_state,
    restore_main_window_state,
    is_desktop,
    identify_monitor,
};

use ndi_output::{
    NdiManager,
    ndi_is_available,
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

const WHISPER_SERVER_PORT: u16 = 17493;

struct WhisperServerState {
    child_pid: Arc<Mutex<Option<u32>>>,
    server_pid: Arc<Mutex<Option<u32>>>,
}

/// Single source of truth for whisper-server readiness. The background poll
/// task in `run_whisper_server` is the only writer; everyone else reads.
/// This eliminates the previous spaghetti of three competing readiness paths
/// (Rust poll + frontend poll + frontend "degraded" state machine).
struct WhisperReadyCache {
    ready: std::sync::atomic::AtomicBool,
    model: Mutex<Option<String>>,
    /// Set once when the prewarm task starts, never reset. Lets us avoid
    /// spawning duplicate poll tasks if `run_whisper_server` is called twice.
    poll_task_spawned: std::sync::atomic::AtomicBool,
}

impl WhisperReadyCache {
    fn new() -> Self {
        Self {
            ready: std::sync::atomic::AtomicBool::new(false),
            model: Mutex::new(None),
            poll_task_spawned: std::sync::atomic::AtomicBool::new(false),
        }
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
struct SermonListenerConfig {
    enabled: bool,
}

struct SermonListenerState {
    config: Arc<Mutex<SermonListenerConfig>>,
}

unsafe impl Send for WhisperServerState {}
unsafe impl Sync for WhisperServerState {}

fn resolve_bundled_model_path(app: &tauri::AppHandle) -> Option<String> {
    let resource_dir = app.path().resource_dir().ok()?;
    let bundled_path = resource_dir.join("assets").join("whisper-models").join("base.en");
    if bundled_path.exists() {
        let path_str = bundled_path.to_string_lossy().to_string();
        // Strip Windows UNC prefix (\\?\) which Python argparse and
        // PyInstaller cannot handle.  Tauri's resource_dir() on Windows
        // returns extended-length paths like
        //   \\?\C:\dev\selah\src-tauri\target\debug
        // which cause "unrecognized arguments" when passed via --model-path.
        let clean_path = path_str.strip_prefix(r"\\?\").unwrap_or(&path_str).to_string();
        println!("Found bundled whisper model at: {}", clean_path);
        Some(clean_path)
    } else {
        eprintln!(
            "No bundled whisper model found at: {}. \
             Run scripts/download-whisper-model.sh to download it.",
            bundled_path.display()
        );
        None
    }
}

async fn run_whisper_server(
    app: tauri::AppHandle,
    state: &WhisperServerState,
    model: Option<String>,
) -> Result<String, String> {
    // The prewarm task is the sole owner of the readiness state machine.
    // If the sidecar is already up (or a previous session left a server on
    // our port), we just return the endpoint and let the prewarm's
    // background poll task drive the Tauri event. No redundant health
    // checks, no extra emit() — that's how we ended up with three
    // competing readiness paths in the first place.
    {
        let already_running = state.child_pid.lock().unwrap().is_some()
            || state.server_pid.lock().unwrap().is_some();
        if already_running {
            let endpoint = format!("http://127.0.0.1:{}", WHISPER_SERVER_PORT);
            return Ok(endpoint);
        }
    }

    // Check if a server is listening on our port (from a previous app session)
    // even though we don't have a PID for it.  If one is found, verify that
    // it actually has a model loaded.  If not, kill it and restart so we
    // get a working server instead of adopting a zombie.
    let orphan_pid = {
        let mut found_pid: Option<u32> = None;
        #[cfg(unix)]
        {
            use std::process::Command;
            if let Ok(output) = Command::new("lsof")
                .args(["-i", &format!(":{}", WHISPER_SERVER_PORT), "-sTCP:LISTEN"])
                .output()
            {
                let output_str = String::from_utf8_lossy(&output.stdout);
                for line in output_str.lines().skip(1) {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        if let Ok(pid) = parts[1].parse::<u32>() {
                            found_pid = Some(pid);
                            break;
                        }
                    }
                }
            }
        }
        #[cfg(windows)]
        {
            use std::process::Command;
            if let Ok(output) = Command::new("netstat")
                .args(["-ano"])
                .output()
            {
                let output_str = String::from_utf8_lossy(&output.stdout);
                for line in output_str.lines() {
                    if line.contains(&format!(":{}", WHISPER_SERVER_PORT)) && line.contains("LISTENING") {
                        if let Some(pid_str) = line.split_whitespace().last() {
                            if let Ok(pid) = pid_str.parse::<u32>() {
                                found_pid = Some(pid);
                                break;
                            }
                        }
                    }
                }
            }
        }
        found_pid
    };

    if let Some(pid) = orphan_pid {
        // Check if the orphan is actually functional (model loaded)
        let endpoint = format!("http://127.0.0.1:{}", WHISPER_SERVER_PORT);
        let health_url = format!("{}/health", &endpoint);
        let orphan_healthy = match reqwest::Client::new()
            .get(&health_url)
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(body) = resp.json::<serde_json::Value>().await {
                    body.get("model_loaded")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false)
                } else {
                    false
                }
            }
            _ => false,
        };

        if orphan_healthy {
            println!("Found existing whisper server on port {} (PID: {}) with model loaded", WHISPER_SERVER_PORT, pid);
            *state.server_pid.lock().unwrap() = Some(pid);
            spawn_readiness_poll(app.clone());
            return Ok(endpoint);
        } else {
            println!("Found zombie whisper server on port {} (PID: {}) without model — killing and restarting", WHISPER_SERVER_PORT, pid);
            kill_whisper_pid(pid);
            // Wait a moment for the port to be released
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    }

    let model_arg = model.unwrap_or_else(|| "base.en".to_string());

    // Resolve the whisper-server executable:
    // 1. Production: resource_dir/assets/whisper-server/selah-whisper-server-{arch}
    // 2. Dev build: resource_dir/selah-whisper-server (Tauri copies sidecar here)
    // 3. Sidecar fallback: Tauri sidecar resolution from binaries/ dir
    let resource_dir = app.path().resource_dir()
        .map_err(|e| format!("Failed to resolve resource dir: {}", e))?;

    let arch_name = std::env::consts::ARCH;
    // Construct the full target triple for the binary name (e.g. aarch64-apple-darwin)
    let target_triple = if cfg!(target_os = "macos") {
        format!("{}-apple-darwin", arch_name)
    } else if cfg!(target_os = "linux") {
        format!("{}-unknown-linux-gnu", arch_name)
    } else if cfg!(target_os = "windows") {
        format!("{}-pc-windows-msvc", arch_name)
    } else {
        arch_name.to_string()
    };

    let whisper_exe_production = if cfg!(target_os = "windows") {
        resource_dir.join("assets").join("whisper-server").join(format!("selah-whisper-server-{}.exe", target_triple))
    } else {
        resource_dir.join("assets").join("whisper-server").join(format!("selah-whisper-server-{}", target_triple))
    };

    // Dev: use the binary inside assets/whisper-server/ so _internal/ is in cwd.
    // The Tauri sidecar copy at resource_dir/selah-whisper-server does NOT
    // bring _internal/ along, which causes PyInstaller to fail with
    // "Failed to load Python shared library".
    let whisper_exe_dev = resource_dir.join("assets").join("whisper-server").join(format!("selah-whisper-server-{}", target_triple));

    let (whisper_exe, using_sidecar_fallback) = if whisper_exe_production.exists() {
        println!("Using production whisper-server at: {}", whisper_exe_production.display());
        (whisper_exe_production, false)
    } else if whisper_exe_dev.exists() {
        println!("Using dev whisper-server at: {} (cwd: {})", whisper_exe_dev.display(), whisper_exe_dev.parent().unwrap().display());
        (whisper_exe_dev, false)
    } else {
        // Fall back to Tauri sidecar mechanism which resolves from the binaries/ directory
        println!("Whisper binary not found at {} or {}, trying Tauri sidecar",
            whisper_exe_production.display(), whisper_exe_dev.display());
        (resource_dir.clone(), true) // placeholder path, won't be used
    };

    // If we have a bundled model, pass its path as --model instead of
    // --model-path. Older PyInstaller builds may not recognise --model-path
    // (it was added later to whisper-server.py), but faster-whisper's
    // WhisperModel() accepts a local directory path for --model just fine
    // (it falls through the model_map lookup and goes straight to the
    // CTranslate2 loader).
    let effective_model = resolve_bundled_model_path(&app)
        .unwrap_or_else(|| model_arg.clone());

    let (mut rx, child_pid) = if using_sidecar_fallback {
        let mut sidecar_cmd = app.shell().sidecar("selah-whisper-server")
            .map_err(|e| format!("Failed to create whisper server sidecar: {}", e))?;
        sidecar_cmd = sidecar_cmd.args(["--port", &WHISPER_SERVER_PORT.to_string(), "--model", &effective_model]);
        // Set cwd to assets/whisper-server/ so PyInstaller _internal/ is found
        let sidecar_cwd = resource_dir.join("assets").join("whisper-server");
        if sidecar_cwd.exists() {
            sidecar_cmd = sidecar_cmd.current_dir(&sidecar_cwd);
            println!("[whisper-server] Sidecar cwd: {}", sidecar_cwd.display());
        }
        let (rx, child) = sidecar_cmd.spawn()
            .map_err(|e| format!("Failed to spawn whisper server sidecar: {}", e))?;
        (rx, child.pid())
    } else {
        // For --onedir builds, the binary needs to find _internal/ relative to itself.
        // Set the current directory to the binary's parent directory.
        let exe_dir = whisper_exe.parent().unwrap_or_else(|| std::path::Path::new("."));
        let cmd = app.shell().command(&whisper_exe)
            .args(["--port", &WHISPER_SERVER_PORT.to_string(), "--model", &effective_model])
            .env("PYTHONUNBUFFERED", "1")
            .current_dir(exe_dir);
        let (rx, child) = cmd.spawn()
            .map_err(|e| format!("Failed to spawn whisper server: {}", e))?;
        (rx, child.pid())
    };

    *state.child_pid.lock().unwrap() = Some(child_pid);

    let endpoint = format!("http://127.0.0.1:{}", WHISPER_SERVER_PORT);

    // Start the readiness poll. Idempotent — only the first call wins.
    spawn_readiness_poll(app.clone());

    // Drain the sidecar's stdout/stderr to our own logs, and surface
    // process death as a Tauri error event. We deliberately do NOT do
    // any "Running on" detection here — the readiness poll handles that
    // by hitting /health, which is faster and doesn't depend on Python's
    // stdout buffering behaviour.
    let app_for_io = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    println!("[whisper-server] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[whisper-server] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(status) => {
                    println!("[whisper-server] exited with status: {:?}", status);
                    if let Some(cache) = app_for_io.try_state::<WhisperReadyCache>() {
                        if !cache.ready.load(std::sync::atomic::Ordering::SeqCst) {
                            let _ = app_for_io.emit("whisper-server://error", serde_json::json!({
                                "error": "sidecar exited before becoming ready",
                            }));
                        }
                    }
                    break;
                }
                CommandEvent::Error(err) => {
                    eprintln!("[whisper-server] error: {}", err);
                    if let Some(cache) = app_for_io.try_state::<WhisperReadyCache>() {
                        if !cache.ready.load(std::sync::atomic::Ordering::SeqCst) {
                            let _ = app_for_io.emit("whisper-server://error", serde_json::json!({
                                "error": format!("sidecar error: {}", err),
                            }));
                        }
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(endpoint)
}

/// Spawn the single readiness poll task. Idempotent — calling this multiple
/// times is harmless because we use an atomic compare-and-swap on the
/// `poll_task_spawned` flag.
///
/// Polls `/health` every 100 ms.  On the first success where the model is
/// loaded we update the cache, emit `whisper-server://ready`, and exit.
/// If the server is up but the model hasn't loaded within 15 s (common on
/// Windows when the model path is wrong and it falls back to lazy loading),
/// we mark ready anyway — the model will load on the first transcription
/// request and blocking forever on the readiness screen helps nobody.
fn spawn_readiness_poll(app: tauri::AppHandle) {
    let cache = match app.try_state::<WhisperReadyCache>() {
        Some(c) => c,
        None => {
            eprintln!("[whisper-server] readiness cache missing — cannot poll");
            return;
        }
    };

    // CAS on the spawned flag — guarantees we only ever have one poll task
    // even if `run_whisper_server` is called from prewarm + frontend + the
    // orphan-detection branch in close succession.
    if cache
        .poll_task_spawned
        .compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::SeqCst,
            std::sync::atomic::Ordering::SeqCst,
        )
        .is_err()
    {
        return;
    }

    let app_for_poll = app.clone();
    tauri::async_runtime::spawn(async move {
        let endpoint = format!("http://127.0.0.1:{}", WHISPER_SERVER_PORT);
        let health_url = format!("{}/health", endpoint);
        let client = reqwest::Client::new();
        let started = std::time::Instant::now();
        let max_wait = std::time::Duration::from_secs(15);

        loop {
            if let Ok(resp) = client
                .get(&health_url)
                .timeout(std::time::Duration::from_millis(500))
                .send()
                .await
            {
                if resp.status().is_success() {
                    if let Ok(body) = resp.json::<serde_json::Value>().await {
                        let loaded = body
                            .get("model_loaded")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        if loaded {
                            let model_str = body
                                .get("model")
                                .and_then(|v| v.as_str())
                                .map(String::from);
                            if let Some(cache) = app_for_poll.try_state::<WhisperReadyCache>() {
                                if let Ok(mut m) = cache.model.lock() {
                                    *m = model_str.clone();
                                }
                                cache.ready.store(true, std::sync::atomic::Ordering::SeqCst);
                            }
                            let elapsed_ms = started.elapsed().as_millis();
                            println!(
                                "[whisper-server] ready after {} ms (model: {:?})",
                                elapsed_ms, model_str
                            );
                            let _ = app_for_poll.emit(
                                "whisper-server://ready",
                                serde_json::json!({
                                    "endpoint": &endpoint,
                                    "model": model_str,
                                    "elapsed_ms": elapsed_ms,
                                }),
                            );
                            return;
                        }
                    }
                }
            }
            // If we've been waiting 15 s and the health endpoint is
            // responding, the server is up — the model will load lazily
            // on the first transcription request.  Don't block the UI.
            if started.elapsed() >= max_wait {
                println!("[whisper-server] server up but model not loaded after 15 s — proceeding (model loads on first request)");
                if let Some(cache) = app_for_poll.try_state::<WhisperReadyCache>() {
                    cache.ready.store(true, std::sync::atomic::Ordering::SeqCst);
                }
                let _ = app_for_poll.emit(
                    "whisper-server://ready",
                    serde_json::json!({
                        "endpoint": &endpoint,
                        "model": serde_json::Value::Null,
                        "elapsed_ms": started.elapsed().as_millis(),
                        "model_loaded": false,
                    }),
                );
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    });
}

fn kill_whisper_pid(pid: u32) {
    #[cfg(unix)]
    {
        use std::process::Command;
        let _ = Command::new("kill").args([&pid.to_string()]).spawn();
    }
    #[cfg(windows)]
    {
        use std::process::Command;
        let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/F"]).spawn();
    }
}

#[tauri::command]
async fn start_whisper_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, WhisperServerState>,
) -> Result<String, String> {
    run_whisper_server(app, &state, None).await
}

#[tauri::command]
async fn stop_whisper_server(
    state: tauri::State<'_, WhisperServerState>,
) -> Result<(), String> {
    let mut pid_guard = state.child_pid.lock().unwrap();
    if let Some(pid) = pid_guard.take() {
        kill_whisper_pid(pid);
        println!("Whisper server stopped (PID: {})", pid);
    }
    Ok(())
}

fn shutdown_whisper_sidecar(state: &WhisperServerState, app: &tauri::AppHandle) {
    if let Ok(mut guard) = state.child_pid.lock() {
        if let Some(pid) = guard.take() {
            kill_whisper_pid(pid);
            println!("[Shutdown] Whisper sidecar killed (PID: {})", pid);
        }
    }
    // Reset the readiness cache so a re-enable triggers a fresh poll.
    if let Some(cache) = app.try_state::<WhisperReadyCache>() {
        cache.ready.store(false, std::sync::atomic::Ordering::SeqCst);
        cache.poll_task_spawned.store(false, std::sync::atomic::Ordering::SeqCst);
        if let Ok(mut m) = cache.model.lock() { *m = None; }
    }
}

#[tauri::command]
async fn get_whisper_server_status(
    state: tauri::State<'_, WhisperServerState>,
) -> Result<serde_json::Value, String> {
    let is_running = state.child_pid.lock().unwrap().is_some() || 
        state.server_pid.lock().unwrap().is_some();
    
    let client = reqwest::Client::new();
    let health_url = format!("http://127.0.0.1:{}/health", WHISPER_SERVER_PORT);
    
    let health_status = if is_running {
        match client.get(&health_url).timeout(std::time::Duration::from_secs(2)).send().await {
            Ok(response) if response.status().is_success() => {
                Some(response.json::<serde_json::Value>().await.ok())
            }
            _ => None
        }
    } else {
        None
    };

    Ok(serde_json::json!({
        "running": is_running,
        "port": WHISPER_SERVER_PORT,
        "health": health_status
    }))
}

#[tauri::command]
async fn check_whisper_ready(
    cache: tauri::State<'_, WhisperReadyCache>,
) -> Result<serde_json::Value, String> {
    // Pure cache read — no HTTP, no awaiting. The poll task is the sole
    // source of truth and updates this atomically before emitting the
    // `whisper-server://ready` event.
    let ready = cache.ready.load(std::sync::atomic::Ordering::SeqCst);
    let model = cache.model.lock().ok().and_then(|m| m.clone());
    Ok(serde_json::json!({
        "ready": ready,
        "model": model,
    }))
}

#[tauri::command]
async fn set_sermon_listener_enabled(
    state: tauri::State<'_, SermonListenerState>,
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<bool, String> {
    let was_enabled = {
        let mut config = state.config.lock().unwrap();
        let was = config.enabled;
        config.enabled = enabled;
        was
    }; // MutexGuard dropped here — safe to await after this

    // If we're enabling and the sidecar isn't running, start it
    if enabled && !was_enabled {
        let sidecar_not_running = {
            let whisper_state = app.state::<WhisperServerState>();
            whisper_state.child_pid.lock().unwrap().is_none() &&
                whisper_state.server_pid.lock().unwrap().is_none()
        }; // drop locks

        if sidecar_not_running {
            let whisper_state = app.state::<WhisperServerState>();
            let result = run_whisper_server(app.clone(), &whisper_state, None).await;
            match result {
                Ok(endpoint) => {
                    println!("[SermonListener] Sidecar started after enabling: {}", endpoint);
                }
                Err(e) => {
                    eprintln!("[SermonListener] Failed to start sidecar after enabling: {}", e);
                }
            }
        }
    }

    // If we're disabling, stop the sidecar
    if !enabled && was_enabled {
        let whisper_state = app.state::<WhisperServerState>();
        shutdown_whisper_sidecar(&whisper_state, &app);
        println!("[SermonListener] Sidecar stopped after disabling");
    }

    Ok(enabled)
}

#[tauri::command]
async fn get_sermon_listener_enabled(
    state: tauri::State<'_, SermonListenerState>,
) -> Result<bool, String> {
    Ok(state.config.lock().unwrap().enabled)
}

/// Check for an app update, and if one is available, download and install it
/// then restart the app. The two closures passed to `download_and_install`
/// are progress callbacks (downloaded-bytes, content-length). They are no-ops
/// here; the frontend can listen for `tauri://update-available` /
/// `tauri://update-download-progress` / `tauri://update-installed` events
/// directly to drive a progress bar.
///
/// Errors are returned as strings so the frontend `try/catch` around
/// `invoke("check_update")` is enough.
#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<String, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => {
            update
                .download_and_install(|_, _| {}, || {})
                .await
                .map_err(|e| e.to_string())?;
            // `app.restart()` (from `tauri-plugin-process`) replaces the
            // running process with the newly installed binary. It does
            // not return on success.
            app.restart();
        }
        None => Ok("up to date".into()),
    }
}

fn prewarm_whisper_server(app: tauri::AppHandle, child_pid: Arc<Mutex<Option<u32>>>, server_pid: Arc<Mutex<Option<u32>>>) {
    println!("[PreWarm] Starting whisper server pre-warm on app launch...");
    let state = WhisperServerState { child_pid, server_pid };
    tauri::async_runtime::spawn(async move {
        match run_whisper_server(app, &state, None).await {
            Ok(endpoint) => {
                println!("[PreWarm] Whisper server pre-warmed successfully: {}", endpoint);
            }
            Err(e) => {
                eprintln!("[PreWarm] Whisper server pre-warm failed: {}", e);
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let multi_monitor_state: Arc<MultiMonitorState> = Arc::new(MultiMonitorState::new());
    let ndi_manager: Arc<NdiManager> = Arc::new(NdiManager::new());
    let whisper_child_pid: Arc<Mutex<Option<u32>>> = Arc::new(Mutex::new(None));
    let whisper_pid: Arc<Mutex<Option<u32>>> = Arc::new(Mutex::new(None));
    let whisper_child_pid_for_prewarm = whisper_child_pid.clone();
    let whisper_pid_for_prewarm = whisper_pid.clone();
    
    let sermon_listener_config = Arc::new(Mutex::new(SermonListenerConfig { enabled: true }));
    let sermon_config_for_prewarm = sermon_listener_config.clone();
    
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Deep-link plugin: registers the `selah://` URL scheme with
        // the OS. This is the RETURN path for OAuth on desktop — the
        // user completes OAuth in the system browser, lands on
        // `https://selah.fly.dev/desktop-oauth-done`, and the
        // "Open Selah" button on that page deep-links to
        // `selah://oauth-complete`. The OS routes the scheme back
        // to the running Selah app, and the handler below emits
        // `oauth://deep-link` with the full URL for the frontend's
        // `useDeepLinkOAuth` hook to consume.
        //
        // We use `selah://` (not `app.selah.desktop://`) because:
        //  - Shorter, less typo-prone for the OS-level scheme
        //  - The OAuth redirect URL is now `https://selah.fly.dev/...`
        //    (not a custom scheme — Clerk's API rejects those), so
        //    the custom scheme is only used for the browser→desktop
        //    handoff, not the OAuth callback itself.
        .plugin(tauri_plugin_deep_link::init())
        .manage(WhisperServerState {
            child_pid: whisper_child_pid,
            server_pid: whisper_pid,
        })
        .manage(WhisperReadyCache::new())
        .manage(AudioCaptureState::new())
        .manage(multi_monitor_state.clone())
        .manage(ndi_manager.clone())
        .manage(SermonListenerState {
            config: sermon_listener_config,
        })
        .invoke_handler(tauri::generate_handler![
            start_whisper_server,
            stop_whisper_server,
            get_whisper_server_status,
            check_whisper_ready,
            set_sermon_listener_enabled,
            get_sermon_listener_enabled,
            list_audio_devices,
            is_system_audio_supported,
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
            clear_live_output,
            get_window_state,
            save_window_state,
            update_main_window_state,
            restore_main_window_state,
            is_desktop,
            identify_monitor,
            ndi_is_available,
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
            start_oauth_listener,
        ])
        .setup(move |app| {
            // Deep-link plugin: the OS launches the app or focuses
            // the running instance when a `selah://...` URL is
            // opened. Forward the URL to the frontend as a Tauri
            // event so `useDeepLinkOAuth` can react (e.g., dismiss
            // the "waiting for OAuth" state, prompt the user to
            // sign in, etc.).
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let app_handle_for_deeplink = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        info!("[deep-link] received url: {}", url);
                        let _ = app_handle_for_deeplink.emit(
                            "oauth://deep-link",
                            url.to_string(),
                        );
                    }
                });
                // Handle the cold-start case where the user clicks
                // the deep link in a fresh browser tab while the
                // app is closed. The plugin buffers the URL and
                // replays it here when a listener is registered
                // early enough.
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    let app_handle_for_cold_start = app.handle().clone();
                    for url in urls {
                        info!("[deep-link] cold-start url: {}", url);
                        let _ = app_handle_for_cold_start.emit(
                            "oauth://deep-link",
                            url.to_string(),
                        );
                    }
                }
            }
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

            let app_handle = app.handle().clone();
            let sermon_enabled = sermon_config_for_prewarm.lock().unwrap().enabled;
            if sermon_enabled {
                prewarm_whisper_server(app_handle, whisper_child_pid_for_prewarm.clone(), whisper_pid_for_prewarm.clone());
            } else {
                info!("[PreWarm] Skipping whisper server — sermon listener is disabled");
            }

            // Ensure the sidecar is terminated when the main window closes,
            // so we don't leak a 300MB Python process on app quit.
            if let Some(window) = app.get_webview_window("main") {
                let handle_for_close = app.handle().clone();
                window.on_window_event(move |event| {
                    if matches!(event, WindowEvent::Destroyed | WindowEvent::CloseRequested { .. }) {
                        if let Some(state) = handle_for_close.try_state::<WhisperServerState>() {
                            shutdown_whisper_sidecar(&state, &handle_for_close);
                        }
                    }
                });
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