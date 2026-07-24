/**
 * Window Manager for multi-monitor support
 *
 * Handles creating, positioning, and managing the live output window
 * across multiple monitors.
 */
use std::sync::Arc;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use super::state::{MultiMonitorState, LIVE_WINDOW_LABEL};
use super::types::*;

/// Generate a human-readable display name.
/// Primary → "Built-in Display", external → "External Display N".
pub fn humanize_display_name(is_primary: bool, external_index: u32) -> String {
    if is_primary {
        "Built-in Display".to_string()
    } else {
        format!("External Display {}", external_index)
    }
}

/// Generate a stable ID from the raw monitor name and position.
/// Uses the raw name (lowercased, spaces replaced with hyphens) plus
/// the position to produce a unique identifier that survives reboots.
pub fn generate_stable_id(raw_name: &str, position_x: i32, position_y: i32) -> String {
    if !raw_name.is_empty() {
        format!(
            "{}-{}x{}",
            raw_name.to_lowercase().replace(' ', "-"),
            position_x,
            position_y
        )
    } else {
        format!("monitor-{}x{}", position_x, position_y)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_humanize_primary_display() {
        assert_eq!(humanize_display_name(true, 0), "Built-in Display");
    }

    #[test]
    fn test_humanize_external_displays() {
        assert_eq!(humanize_display_name(false, 1), "External Display 1");
        assert_eq!(humanize_display_name(false, 2), "External Display 2");
        assert_eq!(humanize_display_name(false, 3), "External Display 3");
    }

    #[test]
    fn test_stable_id_with_raw_name() {
        assert_eq!(
            generate_stable_id("Monitor #14090", 1920, 0),
            "monitor-#14090-1920x0"
        );
    }

    #[test]
    fn test_stable_id_with_empty_name() {
        assert_eq!(generate_stable_id("", 0, 0), "monitor-0x0");
        assert_eq!(generate_stable_id("", 2560, 1440), "monitor-2560x1440");
    }

    #[test]
    fn test_stable_id_lowercases_raw_name() {
        assert_eq!(
            generate_stable_id("DELL U2723QE", 1920, 0),
            "dell-u2723qe-1920x0"
        );
    }

    #[test]
    fn test_stable_id_replaces_spaces_with_hyphens() {
        assert_eq!(
            generate_stable_id("Built In Display", 0, 0),
            "built-in-display-0x0"
        );
    }

    #[test]
    fn test_stable_id_negative_position() {
        assert_eq!(
            generate_stable_id("Left Monitor", -1920, 0),
            "left-monitor--1920x0"
        );
    }

    #[test]
    fn test_stable_id_uniqueness_different_positions() {
        let id1 = generate_stable_id("Monitor", 0, 0);
        let id2 = generate_stable_id("Monitor", 1920, 0);
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_multi_monitor_naming_sequence() {
        let cases = vec![
            (true, 0, "Built-in Display"),
            (false, 1, "External Display 1"),
            (false, 2, "External Display 2"),
        ];
        for (is_primary, idx, expected) in cases {
            assert_eq!(humanize_display_name(is_primary, idx), expected);
        }
    }

    #[test]
    fn test_stable_id_preserves_special_chars_in_raw_name() {
        assert_eq!(
            generate_stable_id("Monitor #14090", 1920, 0),
            "monitor-#14090-1920x0"
        );
        assert_eq!(
            generate_stable_id("Dell-U2723QE", 0, 0),
            "dell-u2723qe-0x0"
        );
    }
}

impl MultiMonitorState {
    /// Get all available monitors with stable IDs
    pub fn get_available_monitors(&self) -> Vec<MonitorInfo> {
        #[cfg(not(target_os = "android"))]
        {
            if let Some(app) = self.get_app() {
                let available = app.available_monitors().unwrap_or_default();
                let primary = app.primary_monitor().unwrap_or_default();

                // First pass: determine which monitors are primary so we can
                // assign human-readable names without double-borrowing.
                let primary_pos = primary.as_ref().map(|p| p.position());

                let items: Vec<_> = available
                    .into_iter()
                    .map(|monitor| {
                        let position = monitor.position();
                        let raw_name = monitor
                            .name()
                            .map(|s| s.to_string())
                            .unwrap_or_default();
                        let is_primary = primary_pos
                            .map(|pp| pp == position)
                            .unwrap_or(position.x == 0 && position.y == 0);
                        (monitor, raw_name, is_primary)
                    })
                    .collect();

                // Second pass: assign human-readable display names
                let mut external_count = 0u32;
                let results: Vec<MonitorInfo> = items
                    .into_iter()
                    .map(|(monitor, raw_name, is_primary)| {
                        let position = monitor.position();
                        let size = monitor.size();

                        let external_idx = if !is_primary {
                            external_count += 1;
                            external_count
                        } else {
                            0
                        };
                        let display_name = humanize_display_name(is_primary, external_idx);
                        let stable_id = generate_stable_id(&raw_name, position.x, position.y);

                        MonitorInfo {
                            id: stable_id,
                            name: display_name,
                            width: size.width,
                            height: size.height,
                            position_x: position.x,
                            position_y: position.y,
                            scale_factor: monitor.scale_factor(),
                            is_primary,
                            refresh_rate: None,
                        }
                    })
                    .collect();

                return results;
            }
        }

        #[cfg(target_os = "android")]
        {
            let _ = self; // silence unused warning
            return vec![MonitorInfo {
                id: "primary".to_string(),
                name: "Primary Screen".to_string(),
                width: 1920,
                height: 1080,
                position_x: 0,
                position_y: 0,
                scale_factor: 1.0,
                is_primary: true,
                refresh_rate: None,
            }];
        }

        // Fallback for when app handle is not available
        vec![]
    }

    /// Get the primary monitor
    pub fn get_primary_monitor(&self) -> Option<MonitorInfo> {
        self.get_available_monitors()
            .into_iter()
            .find(|m| m.is_primary)
    }

    /// Get the best monitor for live output (first non-primary, or primary if only one)
    pub fn get_best_monitor_for_live(&self) -> Option<MonitorInfo> {
        let monitors = self.get_available_monitors();
        // Prefer a non-primary monitor for live output
        monitors
            .iter()
            .find(|m| !m.is_primary)
            .cloned()
            .or_else(|| monitors.first().cloned())
    }

    /// Get monitor by ID
    pub fn get_monitor_by_id(&self, id: &str) -> Option<MonitorInfo> {
        self.get_available_monitors()
            .into_iter()
            .find(|m| m.id == id)
    }

    /// Create the live output window
    pub fn create_live_window(
        &self,
        config: LiveWindowConfig,
        dev_url: Option<&str>,
    ) -> Result<WebviewWindow, MultiMonitorError> {
        let app = self.get_app().ok_or_else(|| MultiMonitorError {
            code: "NO_APP_HANDLE".to_string(),
            message: "Application handle not initialized".to_string(),
        })?;

        // Check if live window already exists
        if let Some(existing) = app.get_webview_window(LIVE_WINDOW_LABEL) {
            // Close existing window first
            let _ = existing.close();
            // Give it a moment to close
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        // Determine target monitor
        let target_monitor = if let Some(ref monitor_id) = config.monitor_id {
            self.get_monitor_by_id(monitor_id)
        } else {
            self.get_best_monitor_for_live()
        };

        let monitor = target_monitor.ok_or_else(|| MultiMonitorError {
            code: "NO_MONITOR".to_string(),
            message: "No suitable monitor found for live output".to_string(),
        })?;

        // Build the URL for the live view. The frontend uses HashRouter, so the
        // route must live in the URL *hash* (`/#/live`) — a plain `/live` path
        // leaves the hash empty, and HashRouter would render the full app at `/`
        // instead of the live output.
        let base_url = dev_url.unwrap_or("tauri://localhost");
        let url = if let Some(ref slide_id) = config.initial_slide_id {
            format!("{}/#/live?slide={}", base_url, slide_id)
        } else {
            format!("{}/#/live", base_url)
        };

        let webview_url = WebviewUrl::External(url.parse().map_err(|e| MultiMonitorError {
            code: "URL_PARSE_ERROR".to_string(),
            message: format!("Failed to parse URL: {}", e),
        })?);

        // Build the window — use visible(false) initially so we can position
        // it before the first paint (avoids flash on wrong monitor)
        let mut builder = WebviewWindowBuilder::new(&app, LIVE_WINDOW_LABEL, webview_url)
            .title("Selah - Live Output")
            .inner_size(800.0, 600.0)
            .position(0.0, 0.0)
            .decorations(config.decorations)
            .always_on_top(config.always_on_top)
            .visible(false)
            .focused(false)
            .skip_taskbar(true);

        if config.fullscreen {
            builder = builder.fullscreen(true);
        }

        let window = builder.build().map_err(|e| MultiMonitorError {
            code: "WINDOW_CREATE_FAILED".to_string(),
            message: format!("Failed to create live window: {}", e),
        })?;

        // Position and size using Physical coordinates — the Monitor API
        // returns physical pixel values, so we must use Physical types
        // (not logical) to land on the correct display on HiDPI setups.
        window
            .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: monitor.position_x,
                y: monitor.position_y,
            }))
            .map_err(|e| MultiMonitorError {
                code: "POSITION_FAILED".to_string(),
                message: format!("Failed to position live window: {}", e),
            })?;

        window
            .set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: monitor.width,
                height: monitor.height,
            }))
            .map_err(|e| MultiMonitorError {
                code: "RESIZE_FAILED".to_string(),
                message: format!("Failed to resize live window: {}", e),
            })?;

        // Now show the window on the correct monitor
        window.show().map_err(|e| MultiMonitorError {
            code: "SHOW_FAILED".to_string(),
            message: format!("Failed to show live window: {}", e),
        })?;

        // Update state
        self.set_current_live_monitor(Some(monitor.id.clone()));
        self.set_live_window_state(if config.fullscreen {
            LiveWindowState::Fullscreen
        } else {
            LiveWindowState::Open
        });

        // Update persisted state
        self.update_window_state(|state| {
            state.live_monitor_id = Some(monitor.id.clone());
            state.live_fullscreen = config.fullscreen;
        });

        // Set up window close handler. Share the *real* state (Arc clones of
        // the same locks) so that closing the window by any path — the user
        // clicking its X, the display being unplugged, an OS/Alt-F4 close —
        // updates the authoritative state. Previously this wrote to a
        // throwaway copy, so the frontend's 1s poll kept seeing "Open" and
        // the Stop/Present button got stuck.
        let live_window_state = Arc::clone(&self.live_window_state);
        let current_live_monitor = Arc::clone(&self.current_live_monitor);

        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { .. } = event {
                *live_window_state.write() = LiveWindowState::Closed;
                *current_live_monitor.write() = None;
            }
        });

        Ok(window)
    }

    /// Close the live output window
    pub fn close_live_window(&self) -> Result<(), MultiMonitorError> {
        let app = self.get_app().ok_or_else(|| MultiMonitorError {
            code: "NO_APP_HANDLE".to_string(),
            message: "Application handle not initialized".to_string(),
        })?;

        if let Some(window) = app.get_webview_window(LIVE_WINDOW_LABEL) {
            window.close().map_err(|e| MultiMonitorError {
                code: "WINDOW_CLOSE_FAILED".to_string(),
                message: format!("Failed to close live window: {}", e),
            })?;
        }

        self.set_live_window_state(LiveWindowState::Closed);
        self.set_current_live_monitor(None);

        Ok(())
    }

    /// Toggle fullscreen on the live window
    pub fn toggle_live_fullscreen(&self) -> Result<bool, MultiMonitorError> {
        let app = self.get_app().ok_or_else(|| MultiMonitorError {
            code: "NO_APP_HANDLE".to_string(),
            message: "Application handle not initialized".to_string(),
        })?;

        let window =
            app.get_webview_window(LIVE_WINDOW_LABEL)
                .ok_or_else(|| MultiMonitorError {
                    code: "NO_LIVE_WINDOW".to_string(),
                    message: "Live window is not open".to_string(),
                })?;

        let is_fullscreen = window.is_fullscreen().map_err(|e| MultiMonitorError {
            code: "FULLSCREEN_CHECK_FAILED".to_string(),
            message: format!("Failed to check fullscreen state: {}", e),
        })?;

        window
            .set_fullscreen(!is_fullscreen)
            .map_err(|e| MultiMonitorError {
                code: "FULLSCREEN_TOGGLE_FAILED".to_string(),
                message: format!("Failed to toggle fullscreen: {}", e),
            })?;

        let new_state = if !is_fullscreen {
            LiveWindowState::Fullscreen
        } else {
            LiveWindowState::Open
        };
        self.set_live_window_state(new_state);

        Ok(!is_fullscreen)
    }

    /// Move live window to a specific monitor
    pub fn move_live_to_monitor(&self, monitor_id: &str) -> Result<(), MultiMonitorError> {
        let app = self.get_app().ok_or_else(|| MultiMonitorError {
            code: "NO_APP_HANDLE".to_string(),
            message: "Application handle not initialized".to_string(),
        })?;

        let monitor = self
            .get_monitor_by_id(monitor_id)
            .ok_or_else(|| MultiMonitorError {
                code: "MONITOR_NOT_FOUND".to_string(),
                message: format!("Monitor {} not found", monitor_id),
            })?;

        let window =
            app.get_webview_window(LIVE_WINDOW_LABEL)
                .ok_or_else(|| MultiMonitorError {
                    code: "NO_LIVE_WINDOW".to_string(),
                    message: "Live window is not open".to_string(),
                })?;

        // First exit fullscreen if in it
        let was_fullscreen = window.is_fullscreen().unwrap_or(false);
        if was_fullscreen {
            window
                .set_fullscreen(false)
                .map_err(|e| MultiMonitorError {
                    code: "FULLSCREEN_EXIT_FAILED".to_string(),
                    message: format!("Failed to exit fullscreen: {}", e),
                })?;
        }

        // Move and resize window
        window
            .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: monitor.position_x,
                y: monitor.position_y,
            }))
            .map_err(|e| MultiMonitorError {
                code: "POSITION_FAILED".to_string(),
                message: format!("Failed to move window: {}", e),
            })?;

        window
            .set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: monitor.width,
                height: monitor.height,
            }))
            .map_err(|e| MultiMonitorError {
                code: "RESIZE_FAILED".to_string(),
                message: format!("Failed to resize window: {}", e),
            })?;

        // Re-enter fullscreen if it was
        if was_fullscreen {
            window.set_fullscreen(true).map_err(|e| MultiMonitorError {
                code: "FULLSCREEN_ENTER_FAILED".to_string(),
                message: format!("Failed to enter fullscreen: {}", e),
            })?;
        }

        self.set_current_live_monitor(Some(monitor_id.to_string()));
        self.update_window_state(|state| {
            state.live_monitor_id = Some(monitor_id.to_string());
        });

        Ok(())
    }

    /// Send a message to the live window via eval
    #[allow(dead_code)]
    pub fn send_to_live_window(&self, message: &str) -> Result<(), MultiMonitorError> {
        let app = self.get_app().ok_or_else(|| MultiMonitorError {
            code: "NO_APP_HANDLE".to_string(),
            message: "Application handle not initialized".to_string(),
        })?;

        if let Some(window) = app.get_webview_window(LIVE_WINDOW_LABEL) {
            window.eval(message).map_err(|e| MultiMonitorError {
                code: "EVAL_FAILED".to_string(),
                message: format!("Failed to send message to live window: {}", e),
            })?;
        }

        Ok(())
    }

    /// Emit an event to the live window
    pub fn emit_to_live_window<T: serde::Serialize + Clone>(
        &self,
        event: &str,
        payload: T,
    ) -> Result<(), MultiMonitorError> {
        let app = self.get_app().ok_or_else(|| MultiMonitorError {
            code: "NO_APP_HANDLE".to_string(),
            message: "Application handle not initialized".to_string(),
        })?;

        app.emit_to(LIVE_WINDOW_LABEL, event, payload)
            .map_err(|e| MultiMonitorError {
                code: "EMIT_FAILED".to_string(),
                message: format!("Failed to emit event to live window: {}", e),
            })?;

        Ok(())
    }
}

