/**
 * Tauri Commands for Multi-Monitor Window Management
 * 
 * These commands are exposed to the frontend via Tauri's IPC mechanism.
 */

use tauri::{AppHandle, Manager, State};
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
    app: AppHandle,
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
        let position = window.outer_position().ok();
        let size = window.outer_size().ok();
        let is_maximized = window.is_maximized().ok();
        
        state.update_window_state(|s| {
            if let Some(pos) = position {
                s.main_position_x = Some(pos.x);
                s.main_position_y = Some(pos.y);
            }
            if let Some(size) = size {
                s.main_width = Some(size.width);
                s.main_height = Some(size.height);
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
            let _ = window.set_position(tauri::Position::Physical(
                tauri::PhysicalPosition { x, y }
            ));
        }
        
        if let (Some(width), Some(height)) = (window_state.main_width, window_state.main_height) {
            let _ = window.set_size(tauri::Size::Physical(
                tauri::PhysicalSize { width, height }
            ));
        }
        
        if window_state.main_maximized {
            let _ = window.maximize();
        }
    }
    
    Ok(())
}

/// Check if running in Tauri desktop environment
#[tauri::command]
pub async fn is_desktop() -> Result<bool, MultiMonitorError> {
    Ok(true)
}
