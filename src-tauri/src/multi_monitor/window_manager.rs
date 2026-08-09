/**
 * Window Manager for multi-monitor support
 *
 * Handles creating, positioning, and managing the live output window
 * across multiple monitors.
 */
use std::sync::Arc;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use super::state::{MultiMonitorState, ALTERNATE_WINDOW_LABEL, LIVE_WINDOW_LABEL};
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

/// The name part of a stable ID — everything before the trailing `-{x}x{y}`.
///
/// The ID encodes position, so a display that comes back at different
/// coordinates (rearranged in system settings, or a projector rejoining a
/// layout that changed while it was away) gets a different ID even though it
/// is the same panel. Matching on the name part is what lets the output window
/// follow it instead of falling back to whatever monitor happens to be next.
///
/// `None` when the host reported no name, since the `monitor-` placeholder
/// identifies nothing and would match every unnamed display.
fn stable_id_name_part(id: &str) -> Option<&str> {
    let is_int = |s: &str| {
        let digits = s.strip_prefix('-').unwrap_or(s);
        !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())
    };

    let (head, y) = id.rsplit_once('x')?;
    if !is_int(y) {
        return None;
    }
    let (name, x) = head.rsplit_once('-')?;
    if !x.bytes().all(|b| b.is_ascii_digit()) || x.is_empty() {
        return None;
    }
    // A negative x left its minus sign behind as the trailing separator.
    let name = name.strip_suffix('-').unwrap_or(name);

    (!name.is_empty() && name != "monitor").then_some(name)
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
    fn name_part_survives_a_display_moving() {
        // The whole point: same panel, new coordinates, same name part — so an
        // output window follows it rather than falling back to another display.
        let plugged_right = generate_stable_id("EPSON PJ", 1920, 0);
        let plugged_left = generate_stable_id("EPSON PJ", -1920, 0);
        assert_ne!(plugged_right, plugged_left);
        assert_eq!(
            stable_id_name_part(&plugged_right),
            stable_id_name_part(&plugged_left)
        );
        assert_eq!(stable_id_name_part(&plugged_right), Some("epson-pj"));
    }

    #[test]
    fn name_part_handles_hyphens_and_symbols_in_the_name() {
        assert_eq!(
            stable_id_name_part(&generate_stable_id("Dell U2723QE", 0, 0)),
            Some("dell-u2723qe")
        );
        assert_eq!(
            stable_id_name_part(&generate_stable_id("Monitor #14090", 1920, 0)),
            Some("monitor-#14090")
        );
        assert_eq!(
            stable_id_name_part(&generate_stable_id("Left Monitor", -1920, -1080)),
            Some("left-monitor")
        );
    }

    #[test]
    fn unnamed_displays_have_no_name_part() {
        // "monitor-0x0" identifies nothing; matching on it would make every
        // unnamed display look like the same one.
        assert_eq!(stable_id_name_part(&generate_stable_id("", 0, 0)), None);
        assert_eq!(stable_id_name_part(&generate_stable_id("", -1920, 0)), None);
        assert_eq!(stable_id_name_part("not-an-id"), None);
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

    /// Find the monitor an output on `id` should now be on, given the current
    /// layout. Exact ID first, then the same display at new coordinates.
    ///
    /// Returns `None` when the display is genuinely gone, which is different
    /// from "moved" and must not be treated as it: silently relocating a
    /// projector output onto the operator's laptop screen mid-service would
    /// put the slides where the congregation can't see them and the operator
    /// can't work.
    fn rematch_monitor(&self, id: &str, monitors: &[MonitorInfo]) -> Option<MonitorInfo> {
        if let Some(exact) = monitors.iter().find(|m| m.id == id) {
            return Some(exact.clone());
        }
        let name = stable_id_name_part(id)?;
        monitors
            .iter()
            .find(|m| stable_id_name_part(&m.id) == Some(name))
            .cloned()
    }

    /// A cheap fingerprint of the current monitor layout.
    ///
    /// Covers every field an output window's geometry is derived from, so a
    /// resolution change, a rearrangement, or a DPI change all register — not
    /// just monitors appearing and disappearing.
    fn layout_fingerprint(monitors: &[MonitorInfo]) -> String {
        monitors
            .iter()
            .map(|m| {
                format!(
                    "{}:{}x{}@{},{}:{}",
                    m.id, m.width, m.height, m.position_x, m.position_y, m.scale_factor
                )
            })
            .collect::<Vec<_>>()
            .join("|")
    }

    /// Re-apply position and size to every open output window.
    ///
    /// Geometry was previously set once at creation and never revisited, so a
    /// projector that slept and woke, an HDMI cable reseated, or a resolution
    /// changed mid-service left the output window sized for a layout that no
    /// longer existed. Physical coordinates throughout, matching
    /// `build_output_window`.
    pub fn reapply_output_geometry(&self) {
        let Some(app) = self.get_app() else { return };
        let monitors = self.get_available_monitors();
        if monitors.is_empty() {
            return;
        }

        let live_monitor_id = self.current_live_monitor.read().clone();

        for label in [LIVE_WINDOW_LABEL, ALTERNATE_WINDOW_LABEL] {
            let Some(window) = app.get_webview_window(label) else {
                continue;
            };

            // The live output tracks the monitor it was opened on. The
            // alternate output isn't tracked in state, so fall back to
            // wherever the window currently sits.
            let wanted = match (label, live_monitor_id.as_deref()) {
                (LIVE_WINDOW_LABEL, Some(id)) => self.rematch_monitor(id, &monitors),
                _ => window
                    .current_monitor()
                    .ok()
                    .flatten()
                    .and_then(|m| {
                        let pos = m.position();
                        monitors
                            .iter()
                            .find(|c| c.position_x == pos.x && c.position_y == pos.y)
                            .cloned()
                    }),
            };

            let Some(monitor) = wanted else {
                println!(
                    "[multi-monitor] {} display is gone; leaving the window where it is",
                    label
                );
                continue;
            };

            let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: monitor.position_x,
                y: monitor.position_y,
            }));
            let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: monitor.width,
                height: monitor.height,
            }));

            // The live output's stored monitor ID follows the display, so a
            // later re-match starts from the coordinates it actually has.
            if label == LIVE_WINDOW_LABEL {
                self.set_current_live_monitor(Some(monitor.id.clone()));
                self.update_window_state(|state| {
                    state.live_monitor_id = Some(monitor.id.clone());
                });
            }

            println!(
                "[multi-monitor] re-applied {} geometry to {} ({}x{} @ {},{})",
                label, monitor.name, monitor.width, monitor.height, monitor.position_x, monitor.position_y
            );
        }
    }

    /// Watch for monitor-configuration changes and keep the outputs correct.
    ///
    /// Tauri has no cross-platform "displays changed" event, so this polls.
    /// The cost is one `available_monitors()` call every couple of seconds
    /// against a failure that otherwise persists for the rest of a service.
    pub fn spawn_monitor_watcher(self: &Arc<Self>) {
        let state = Arc::clone(self);
        std::thread::spawn(move || {
            let mut fingerprint: Option<String> = None;

            loop {
                std::thread::sleep(std::time::Duration::from_secs(2));

                let Some(app) = state.get_app() else { continue };
                let monitors = state.get_available_monitors();
                if monitors.is_empty() {
                    // A transient enumeration failure is not a layout change;
                    // treating it as one would relocate the output twice.
                    continue;
                }

                let current = Self::layout_fingerprint(&monitors);
                let Some(previous) = fingerprint.replace(current.clone()) else {
                    continue; // First observation is the baseline, not a change.
                };
                if previous == current {
                    continue;
                }

                println!("[multi-monitor] display configuration changed");
                state.reapply_output_geometry();

                let _ = app.emit(
                    "monitor-config-changed",
                    MonitorEventPayload {
                        event_type: "configuration-changed".to_string(),
                        monitor: None,
                        monitors,
                    },
                );
            }
        });
    }

    /// Create the live output window
    /// The monitor an output should open on: the one asked for, else the best
    /// available.
    fn resolve_target_monitor(&self, monitor_id: Option<&str>) -> Result<MonitorInfo, MultiMonitorError> {
        let target = match monitor_id {
            Some(id) => self.get_monitor_by_id(id),
            None => self.get_best_monitor_for_live(),
        };

        target.ok_or_else(|| MultiMonitorError {
            code: "NO_MONITOR".to_string(),
            message: "No suitable monitor found for output".to_string(),
        })
    }

    /// Create a full-screen output window on `monitor`, replacing any existing
    /// window with the same label.
    ///
    /// Shared by the live output and the alternate output: they differ only in
    /// label, title and route. Events are addressed by label, so two windows
    /// running the same `/#/live` view show whatever is emitted to each of them —
    /// which is what makes an alternate output with its own content possible
    /// without a second copy of the renderer.
    fn build_output_window(
        &self,
        label: &str,
        title: &str,
        route: &str,
        monitor: &MonitorInfo,
        config: &LiveWindowConfig,
        dev_url: Option<&str>,
    ) -> Result<WebviewWindow, MultiMonitorError> {
        let app = self.get_app().ok_or_else(|| MultiMonitorError {
            code: "NO_APP_HANDLE".to_string(),
            message: "Application handle not initialized".to_string(),
        })?;

        if let Some(existing) = app.get_webview_window(label) {
            let _ = existing.close();
            // Give it a moment to close before reusing the label.
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        // The frontend uses HashRouter, so the route must live in the URL *hash*
        // — a plain `/live` path leaves the hash empty and HashRouter would
        // render the whole app instead of the output view.
        let base_url = dev_url.unwrap_or("tauri://localhost");
        let url = format!("{}{}", base_url, route);
        let webview_url = WebviewUrl::External(url.parse().map_err(|e| MultiMonitorError {
            code: "URL_PARSE_ERROR".to_string(),
            message: format!("Failed to parse URL: {}", e),
        })?);

        // visible(false) first so the window can be positioned before its first
        // paint, which avoids a flash on the wrong monitor.
        let mut builder = WebviewWindowBuilder::new(&app, label, webview_url)
            .title(title)
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
            message: format!("Failed to create {} window: {}", label, e),
        })?;

        // Physical coordinates throughout: the Monitor API reports physical
        // pixels, and logical values land on the wrong display on HiDPI setups.
        window
            .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: monitor.position_x,
                y: monitor.position_y,
            }))
            .map_err(|e| MultiMonitorError {
                code: "POSITION_FAILED".to_string(),
                message: format!("Failed to position {} window: {}", label, e),
            })?;

        window
            .set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: monitor.width,
                height: monitor.height,
            }))
            .map_err(|e| MultiMonitorError {
                code: "RESIZE_FAILED".to_string(),
                message: format!("Failed to resize {} window: {}", label, e),
            })?;

        window.show().map_err(|e| MultiMonitorError {
            code: "SHOW_FAILED".to_string(),
            message: format!("Failed to show {} window: {}", label, e),
        })?;

        Ok(window)
    }

    /// Open the alternate output on a monitor. Deliberately does not touch the
    /// live window's state — the two outputs are independent, and the projector
    /// must not appear to stop because a second output opened.
    pub fn create_alternate_window(
        &self,
        monitor_id: Option<&str>,
        dev_url: Option<&str>,
    ) -> Result<WebviewWindow, MultiMonitorError> {
        let monitor = self.resolve_target_monitor(monitor_id)?;
        let config = LiveWindowConfig {
            monitor_id: monitor_id.map(|id| id.to_string()),
            fullscreen: true,
            decorations: false,
            always_on_top: false,
            initial_slide_id: None,
        };

        // `output=alternate` tells the view which output it is, so it can ignore
        // the shared live state the projector window falls back on.
        self.build_output_window(
            ALTERNATE_WINDOW_LABEL,
            "Selah - Alternate Output",
            "/#/live?output=alternate",
            &monitor,
            &config,
            dev_url,
        )
    }

    /// Close the alternate output window, if it's open.
    pub fn close_alternate_window(&self) -> Result<(), MultiMonitorError> {
        let app = self.get_app().ok_or_else(|| MultiMonitorError {
            code: "NO_APP_HANDLE".to_string(),
            message: "Application handle not initialized".to_string(),
        })?;

        if let Some(window) = app.get_webview_window(ALTERNATE_WINDOW_LABEL) {
            window.close().map_err(|e| MultiMonitorError {
                code: "CLOSE_FAILED".to_string(),
                message: format!("Failed to close alternate window: {}", e),
            })?;
        }

        Ok(())
    }

    /// Whether the alternate output window is open.
    pub fn is_alternate_window_open(&self) -> bool {
        self.get_app()
            .map(|app| app.get_webview_window(ALTERNATE_WINDOW_LABEL).is_some())
            .unwrap_or(false)
    }

    pub fn create_live_window(
        &self,
        config: LiveWindowConfig,
        dev_url: Option<&str>,
    ) -> Result<WebviewWindow, MultiMonitorError> {
        let monitor = self.resolve_target_monitor(config.monitor_id.as_deref())?;
        let route = match config.initial_slide_id {
            Some(ref slide_id) => format!("/#/live?slide={}", slide_id),
            None => "/#/live".to_string(),
        };
        let window = self.build_output_window(
            LIVE_WINDOW_LABEL,
            "Selah - Live Output",
            &route,
            &monitor,
            &config,
            dev_url,
        )?;

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
    /// Emit an event to a specific output window. The live and alternate windows
    /// run the same view and listen for the same event names, so the label is
    /// what decides which output receives the content.
    pub fn emit_to_output_window<T: serde::Serialize + Clone>(
        &self,
        label: &str,
        event: &str,
        payload: T,
    ) -> Result<(), MultiMonitorError> {
        let app = self.get_app().ok_or_else(|| MultiMonitorError {
            code: "NO_APP_HANDLE".to_string(),
            message: "Application handle not initialized".to_string(),
        })?;

        app.emit_to(label, event, payload)
            .map_err(|e| MultiMonitorError {
                code: "EMIT_FAILED".to_string(),
                message: format!("Failed to emit event to {} window: {}", label, e),
            })
    }

    /// Emit to the alternate output window.
    pub fn emit_to_alternate_window<T: serde::Serialize + Clone>(
        &self,
        event: &str,
        payload: T,
    ) -> Result<(), MultiMonitorError> {
        self.emit_to_output_window(ALTERNATE_WINDOW_LABEL, event, payload)
    }

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

