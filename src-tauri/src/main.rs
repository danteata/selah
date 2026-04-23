// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio_capture;
mod multi_monitor;
mod ndi_output;

use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

// Import audio capture state and commands
use audio_capture::{
    AudioCaptureState,
    // Device listing
    list_audio_devices,
    // Unified capture API
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

// Import multi-monitor state and commands
use multi_monitor::{
    MultiMonitorState,
    // Commands
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
    child: Mutex<Option<CommandChild>>,
    server_pid: Mutex<Option<u32>>,
}

#[tauri::command]
async fn start_whisper_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, WhisperServerState>,
    model: Option<String>,
) -> Result<String, String> {
    // Check if server is already running
    if state.child.lock().unwrap().is_some() {
        return Ok(format!("http://127.0.0.1:{}", WHISPER_SERVER_PORT));
    }

    // Check if a whisper server is already running from a previous session
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
                        println!("Found existing whisper server on port {} (PID: {}), reusing it", WHISPER_SERVER_PORT, pid);
                        *state.server_pid.lock().unwrap() = Some(pid);
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
                            println!("Found existing whisper server on port {} (PID: {}), reusing it", WHISPER_SERVER_PORT, pid);
                            *state.server_pid.lock().unwrap() = Some(pid);
                            return Ok(format!("http://127.0.0.1:{}", WHISPER_SERVER_PORT));
                        }
                    }
                }
            }
        }
    }

    // Start the whisper server sidecar
    let model_arg = model.unwrap_or_else(|| "base.en".to_string());
    
    let shell = app.shell();
    let sidecar_command = shell.sidecar("selah-whisper-server")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?
        .args([
            "--port", &WHISPER_SERVER_PORT.to_string(),
            "--model", &model_arg,
        ]);

    let (rx, child) = sidecar_command.spawn()
        .map_err(|e| format!("Failed to spawn whisper server: {}", e))?;

    // Store the child process
    *state.child.lock().unwrap() = Some(child);

    // Log sidecar output for debugging
    let sidecar_rx = rx;
    tokio::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        let mut rx = sidecar_rx;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    println!("[WhisperServer] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[WhisperServer:stderr] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(status) => {
                    println!("[WhisperServer] Process exited with status: {:?}", status);
                    break;
                }
                CommandEvent::Error(err) => {
                    eprintln!("[WhisperServer:error] {}", err);
                    break;
                }
                _ => {}
            }
        }
    });

    // Wait for server to be ready
    println!("Waiting for whisper server to start on port {}...", WHISPER_SERVER_PORT);
    
    // Give it some time to start
    std::thread::sleep(std::time::Duration::from_secs(2));
    
    // Check if server is responding
    let client = reqwest::Client::new();
    let health_url = format!("http://127.0.0.1:{}/health", WHISPER_SERVER_PORT);
    
    for attempt in 0..15 {
        if let Ok(response) = client.get(&health_url).timeout(std::time::Duration::from_secs(1)).send().await {
            if response.status().is_success() {
                println!("Whisper server is ready!");
                return Ok(format!("http://127.0.0.1:{}", WHISPER_SERVER_PORT));
            }
        }
        println!("Waiting for whisper server... attempt {}", attempt + 1);
        std::thread::sleep(std::time::Duration::from_secs(1));
    }

    // Check if the sidecar process is still running
    let child_guard = state.child.lock().unwrap();
    let still_running = child_guard.is_some();
    drop(child_guard);

    if still_running {
        println!("Whisper server process is running but not responding on port {}", WHISPER_SERVER_PORT);
        Ok(format!("http://127.0.0.1:{}", WHISPER_SERVER_PORT))
    } else {
        Err(format!("Whisper server process exited - check logs for errors"))
    }
}

#[tauri::command]
async fn stop_whisper_server(
    state: tauri::State<'_, WhisperServerState>,
) -> Result<(), String> {
    let mut child_guard = state.child.lock().unwrap();
    
    if let Some(child) = child_guard.take() {
        child.kill().map_err(|e| format!("Failed to kill whisper server: {}", e))?;
        println!("Whisper server stopped");
    }
    
    Ok(())
}

#[tauri::command]
async fn get_whisper_server_status(
    state: tauri::State<'_, WhisperServerState>,
) -> Result<serde_json::Value, String> {
    let is_running = state.child.lock().unwrap().is_some() || 
        state.server_pid.lock().unwrap().is_some();
    
    // Try to check health endpoint
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Create multi-monitor state
    let multi_monitor_state = Arc::new(MultiMonitorState::new());
    let ndi_manager = Arc::new(NdiManager::new());
    
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(WhisperServerState {
            child: Mutex::new(None),
            server_pid: Mutex::new(None),
        })
        .manage(AudioCaptureState::new())
        .manage(multi_monitor_state.clone())
        .manage(ndi_manager.clone())
        .invoke_handler(tauri::generate_handler![
            start_whisper_server,
            stop_whisper_server,
            get_whisper_server_status,
            // Audio capture commands
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
            // Multi-monitor commands
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
            // NDI commands
            ndi_is_available,
            ndi_get_state,
            ndi_start_output,
            ndi_stop_output,
            ndi_send_video_frame,
            ndi_send_audio_frame,
            ndi_discover_sources,
        ])
        .setup(move |app| {
            // Initialize multi-monitor state with app handle
            multi_monitor_state.init(app.handle().clone());

            // Initialize NDI manager with app handle
            ndi_manager.init(app.handle().clone());
            
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
