/**
 * Tauri Commands for Multi-Monitor Window Management
 * 
 * These commands are exposed to the frontend via Tauri's IPC mechanism.
 */

use tauri::{State, AppHandle, Manager};
use std::sync::Arc;

use super::types::*;
use super::state::MultiMonitorState;

/// Get all available monitors
#[tauri::command]
pub async fn get_monitors(
    state: State<'_, Arc<MultiMonitorState>>,
) -> Result<Vec<MonitorInfo>, MultiMonitorError> {
    Ok(state.get_available_monitors())
}

/// Get the primary monitor
#[tauri::command]
pub async fn get_primary_monitor(
    state: State<'_, Arc<MultiMonitorState>>,
) -> Result<Option<MonitorInfo>, MultiMonitorError> {
    Ok(state.get_primary_monitor())
}

/// Get the best monitor for live output
#[tauri::command]
pub async fn get_best_live_monitor(
    state: State<'_, Arc<MultiMonitorState>>,
) -> Result<Option<MonitorInfo>, MultiMonitorError> {
    Ok(state.get_best_monitor_for_live())
}

/// Open the live output window
#[tauri::command]
pub async fn open_live_window(
    _app: AppHandle,
    state: State<'_, Arc<MultiMonitorState>>,
    config: Option<LiveWindowConfig>,
) -> Result<(), MultiMonitorError> {
    let config = config.unwrap_or_default();
    
    // Determine if we're in dev mode
    let dev_url = if cfg!(debug_assertions) {
        Some("http://localhost:3000")
    } else {
        None
    };
    
    state.create_live_window(config, dev_url)?;
    
    Ok(())
}

/// Open the alternate output on a monitor.
///
/// Runs the same view as the live output in its own window, so it renders
/// everything the projector does — backgrounds and media included — while
/// receiving its own content, addressed by window label.
#[tauri::command]
pub async fn open_alternate_window(
    state: State<'_, Arc<MultiMonitorState>>,
    monitor_id: Option<String>,
) -> Result<(), MultiMonitorError> {
    let dev_url = if cfg!(debug_assertions) {
        Some("http://localhost:3000")
    } else {
        None
    };

    state.create_alternate_window(monitor_id.as_deref(), dev_url)?;

    Ok(())
}

/// Close the alternate output window
#[tauri::command]
pub async fn close_alternate_window(
    state: State<'_, Arc<MultiMonitorState>>,
) -> Result<(), MultiMonitorError> {
    state.close_alternate_window()
}

#[tauri::command]
pub async fn is_alternate_window_open(
    state: State<'_, Arc<MultiMonitorState>>,
) -> Result<bool, MultiMonitorError> {
    Ok(state.is_alternate_window_open())
}

/// Send an event — a slide, a settings change — to the alternate output window.
#[tauri::command]
pub async fn emit_to_alternate_window(
    state: State<'_, Arc<MultiMonitorState>>,
    event: String,
    payload: serde_json::Value,
) -> Result<(), MultiMonitorError> {
    state.emit_to_alternate_window(&event, payload)
}

/// Close the live output window
#[tauri::command]
pub async fn close_live_window(
    state: State<'_, Arc<MultiMonitorState>>,
) -> Result<(), MultiMonitorError> {
    state.close_live_window()
}

/// Toggle fullscreen on the live window
#[tauri::command]
pub async fn toggle_live_fullscreen(
    state: State<'_, Arc<MultiMonitorState>>,
) -> Result<bool, MultiMonitorError> {
    state.toggle_live_fullscreen()
}

/// Move live window to a specific monitor
#[tauri::command]
pub async fn move_live_to_monitor(
    state: State<'_, Arc<MultiMonitorState>>,
    monitor_id: String,
) -> Result<(), MultiMonitorError> {
    state.move_live_to_monitor(&monitor_id)
}

/// Get current live window state
#[tauri::command]
pub async fn get_live_window_state(
    state: State<'_, Arc<MultiMonitorState>>,
) -> Result<LiveWindowState, MultiMonitorError> {
    Ok(state.get_live_window_state())
}

/// Check if live window is open
#[tauri::command]
pub async fn is_live_window_open(
    state: State<'_, Arc<MultiMonitorState>>,
) -> Result<bool, MultiMonitorError> {
    Ok(state.is_live_window_open())
}

/// Get current live monitor ID
#[tauri::command]
pub async fn get_current_live_monitor(
    state: State<'_, Arc<MultiMonitorState>>,
) -> Result<Option<String>, MultiMonitorError> {
    Ok(state.get_current_live_monitor())
}

/// Send slide update to live window
#[tauri::command]
pub async fn send_slide_to_live(
    state: State<'_, Arc<MultiMonitorState>>,
    slide_id: String,
    slide_data: Option<serde_json::Value>,
) -> Result<(), MultiMonitorError> {
    let payload = serde_json::json!({
        "type": "slide-update",
        "slideId": slide_id,
        "slideData": slide_data,
    });
    
    state.emit_to_live_window("slide-update", payload)
}

/// Send display-settings update (font, verse ref position, etc.) to live window
#[tauri::command]
pub async fn send_settings_to_live(
    state: State<'_, Arc<MultiMonitorState>>,
    settings: serde_json::Value,
) -> Result<(), MultiMonitorError> {
    let payload = serde_json::json!({
        "type": "settings-update",
        "settings": settings,
    });

    state.emit_to_live_window("settings-update", payload)
}

/// Send clear/blank command to live window
#[tauri::command]
pub async fn clear_live_output(
    state: State<'_, Arc<MultiMonitorState>>,
    mode: Option<String>,
) -> Result<(), MultiMonitorError> {
    let mode = mode.unwrap_or_else(|| "clear".to_string());
    let payload = serde_json::json!({
        "type": "clear-output",
        "mode": mode,
    });
    
    state.emit_to_live_window("clear-output", payload)
}

/// Get persisted window state
#[tauri::command]
pub async fn get_window_state(
    state: State<'_, Arc<MultiMonitorState>>,
) -> Result<WindowState, MultiMonitorError> {
    Ok(state.get_window_state())
}

/// Save window state
#[tauri::command]
pub async fn save_window_state(
    state: State<'_, Arc<MultiMonitorState>>,
    window_state: WindowState,
) -> Result<(), MultiMonitorError> {
    state.load_state(window_state);
    Ok(())
}

/// Update main window position in state
#[tauri::command]
pub async fn update_main_window_state(
    app: AppHandle,
    state: State<'_, Arc<MultiMonitorState>>,
) -> Result<(), MultiMonitorError> {
    if let Some(window) = app.get_webview_window("main") {
        let position: Result<tauri::PhysicalPosition<i32>, _> = window.outer_position();
        let size: Result<tauri::PhysicalSize<u32>, _> = window.outer_size();
        let is_maximized: Result<bool, _> = window.is_maximized();
        
        state.update_window_state(|s| {
            if let Ok(pos) = position {
                s.main_position_x = Some(pos.x);
                s.main_position_y = Some(pos.y);
            }
            if let Ok(sz) = size {
                s.main_width = Some(sz.width);
                s.main_height = Some(sz.height);
            }
            s.main_maximized = is_maximized.unwrap_or(false);
        });
    }
    
    Ok(())
}

/// Restore main window position from state
#[tauri::command]
pub async fn restore_main_window_state(
    app: AppHandle,
    state: State<'_, Arc<MultiMonitorState>>,
) -> Result<(), MultiMonitorError> {
    let window_state = state.get_window_state();
    
    if let Some(window) = app.get_webview_window("main") {
        // Restore position and size if available
        if let (Some(x), Some(y)) = (window_state.main_position_x, window_state.main_position_y) {
            let _: Result<(), _> = window.set_position(tauri::Position::Physical(
                tauri::PhysicalPosition { x, y }
            ));
        }
        
        if let (Some(width), Some(height)) = (window_state.main_width, window_state.main_height) {
            let _: Result<(), _> = window.set_size(tauri::Size::Physical(
                tauri::PhysicalSize { width, height }
            ));
        }
        
        if window_state.main_maximized {
            let _: Result<(), _> = window.maximize();
        }
    }
    
    Ok(())
}

/// Check if running in Tauri desktop environment
#[tauri::command]
pub async fn is_desktop() -> Result<bool, MultiMonitorError> {
    Ok(true)
}

/// Open a temporary identification window on a specific monitor.
/// Shows a colored border with the monitor name and auto-closes after 3 seconds.
#[tauri::command]
pub async fn identify_monitor(
    app: AppHandle,
    state: State<'_, Arc<MultiMonitorState>>,
    monitor_id: String,
    color: String,
    name: String,
) -> Result<(), MultiMonitorError> {
    let monitor = state.get_monitor_by_id(&monitor_id).ok_or_else(|| MultiMonitorError {
        code: "MONITOR_NOT_FOUND".to_string(),
        message: format!("Monitor {} not found", monitor_id),
    })?;

    let label = "selah-identify";

    // Close any existing identification window
    if let Some(existing) = app.get_webview_window(label) {
        let _ = existing.close();
        std::thread::sleep(std::time::Duration::from_millis(150));
    }

    // Navigate to identify.html served from the app's origin (avoids
    // data: URL blank-window bug on macOS/WKWebView). Color and name
    // are sent via a Tauri event after the window loads so no URL-encoding
    // issues.
    let dev_url = if cfg!(debug_assertions) {
        "http://localhost:3000"
    } else {
        "tauri://localhost"
    };
    let url = format!("{}/identify.html", dev_url);
    let webview_url = tauri::WebviewUrl::External(url.parse().unwrap());

    let window = tauri::WebviewWindowBuilder::new(&app, label, webview_url)
        .title("Identify")
        .inner_size(800.0, 600.0)
        .position(monitor.position_x as f64, monitor.position_y as f64)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .transparent(true)
        .build()
        .map_err(|e| MultiMonitorError {
            code: "WINDOW_CREATE_FAILED".to_string(),
            message: format!("Failed to create identification window: {}", e),
        })?;

    // Position on the correct monitor using physical coordinates
    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
        x: monitor.position_x,
        y: monitor.position_y,
    }));
    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
        width: monitor.width,
        height: monitor.height,
    }));
    let _ = window.show();

    // Use eval() to push color/name into the window. The page is served
    // from the app's own origin so eval works reliably (unlike the old
    // about:blank race condition). We use a small delay for the page JS
    // to finish parsing, then call the global applyIdentity function.
    let eval_js = format!(
        r#"setTimeout(function(){{ if(window.applyIdentity) window.applyIdentity("{}", "{}"); }}, 200);"#,
        color.replace('\\', "\\\\").replace('"', "\\\""),
        name.replace('\\', "\\\\").replace('"', "\\\"")
    );
    let _ = window.eval(&eval_js);

    // Auto-close after 3.5 seconds
    let app_handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(3500));
        if let Some(w) = app_handle.get_webview_window(label) {
            let _ = w.close();
        }
    });

    Ok(())
}
