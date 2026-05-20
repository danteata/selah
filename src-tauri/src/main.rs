// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio_capture;
mod multi_monitor;
mod ndi_output;

use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_shell::ShellExt;

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
        println!("Found bundled whisper model at: {}", bundled_path.display());
        Some(bundled_path.to_string_lossy().to_string())
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
    // even though we don't have a PID for it.
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
                    let pid_str = parts[1];
                    if let Ok(pid) = pid_str.parse::<u32>() {
                        println!("Found existing whisper server on port {} (PID: {})", WHISPER_SERVER_PORT, pid);
                        *state.server_pid.lock().unwrap() = Some(pid);
                        // Spawn the readiness poll task against the orphan
                        // server so the frontend gets a ready event when
                        // the model finishes loading.
                        spawn_readiness_poll(app.clone());
                        return Ok(format!("http://127.0.0.1:{}", WHISPER_SERVER_PORT));
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
                            println!("Found existing whisper server on port {} (PID: {})", WHISPER_SERVER_PORT, pid);
                            *state.server_pid.lock().unwrap() = Some(pid);
                            spawn_readiness_poll(app.clone());
                            return Ok(format!("http://127.0.0.1:{}", WHISPER_SERVER_PORT));
                        }
                    }
                }
            }
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

    let (mut rx, child_pid) = if using_sidecar_fallback {
        let mut sidecar_cmd = app.shell().sidecar("selah-whisper-server")
            .map_err(|e| format!("Failed to create whisper server sidecar: {}", e))?;
        sidecar_cmd = sidecar_cmd.args(["--port", &WHISPER_SERVER_PORT.to_string(), "--model", &model_arg]);
        // Set cwd to assets/whisper-server/ so PyInstaller _internal/ is found
        let sidecar_cwd = resource_dir.join("assets").join("whisper-server");
        if sidecar_cwd.exists() {
            sidecar_cmd = sidecar_cmd.current_dir(&sidecar_cwd);
            println!("[whisper-server] Sidecar cwd: {}", sidecar_cwd.display());
        }
        if let Some(bundled_path) = resolve_bundled_model_path(&app) {
            println!("Using bundled model path: {}", bundled_path);
            sidecar_cmd = sidecar_cmd.args(["--model-path", &bundled_path]);
        }
        let (rx, child) = sidecar_cmd.spawn()
            .map_err(|e| format!("Failed to spawn whisper server sidecar: {}", e))?;
        (rx, child.pid())
    } else {
        // For --onedir builds, the binary needs to find _internal/ relative to itself.
        // Set the current directory to the binary's parent directory.
        let exe_dir = whisper_exe.parent().unwrap_or_else(|| std::path::Path::new("."));
        let mut cmd = app.shell().command(&whisper_exe)
            .args(["--port", &WHISPER_SERVER_PORT.to_string(), "--model", &model_arg])
            .env("PYTHONUNBUFFERED", "1")
            .current_dir(exe_dir);
        if let Some(bundled_path) = resolve_bundled_model_path(&app) {
            println!("Using bundled model path: {}", bundled_path);
            cmd = cmd.args(["--model-path", &bundled_path]);
        }
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
/// Polls `/health` every 100 ms forever until the model is loaded. On the
/// first success we update the cache, emit `whisper-server://ready` once,
/// and exit. There is no timeout, no "degraded" event, no fallback — if the
/// sidecar dies the stdout watcher in `run_whisper_server` will emit
/// `whisper-server://error` instead.
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
                            // Update the cache before emitting so an
                            // immediate `check_whisper_ready` from JS
                            // sees the new state.
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
        ])
        .setup(move |app| {
            multi_monitor_state.init(app.handle().clone());
            ndi_manager.init(app.handle().clone());

            let app_handle = app.handle().clone();
            let sermon_enabled = sermon_config_for_prewarm.lock().unwrap().enabled;
            if sermon_enabled {
                prewarm_whisper_server(app_handle, whisper_child_pid_for_prewarm.clone(), whisper_pid_for_prewarm.clone());
            } else {
                println!("[PreWarm] Skipping whisper server — sermon listener is disabled");
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