//! The dictation pill — a small always-on-top indicator that says the
//! microphone is live.
//!
//! Without it dictation is invisible: the operator presses the hotkey and
//! nothing happens until text appears, so there is no way to tell a session
//! that is listening from one that never started, and no way to tell a slow
//! model from a dead microphone.
//!
//! ## It must never take focus
//!
//! This is the constraint the whole module is shaped around. Dictation inserts
//! at the caret of the focused field in the main window, and
//! `insertTextAtCaret` refuses when `document.hasFocus()` is false. A pill that
//! activates on show would move focus to itself, and every dictation would land
//! on the clipboard instead of in the field the operator was typing in — a
//! failure that looks like the insertion code being broken rather than the
//! indicator being at fault.
//!
//! Three things keep that from happening: the window is built `focused(false)`,
//! it is created once and thereafter only shown and hidden (a rebuild is
//! another chance to activate), and it ignores cursor events entirely, so a
//! stray click passes through to whatever is behind it.
//!
//! Ignoring the cursor also means the pill cannot be dragged. That is a real
//! cost, taken deliberately: the failure the placement has to avoid is
//! appearing on the wrong display, which is solved by putting it on the monitor
//! the operator is already looking at, not by letting them move it afterwards.
//!
//! ## The page
//!
//! `public/dictation-pill.html`, served from the app's own origin rather than a
//! `data:` URL — the same choice `identify_monitor` documents, for the same
//! WKWebView blank-window bug. It listens for `dictation://state` and for the
//! `audio-features` frames the capture loop already broadcasts, so the level
//! meter needs no plumbing of its own.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tracing::warn;

pub const PILL_LABEL: &str = "dictation-pill";

/// Logical size. Wide enough for a label and a meter, small enough to sit over
/// a slide without hiding anything.
const PILL_WIDTH: f64 = 236.0;
const PILL_HEIGHT: f64 = 60.0;

/// Gap between the pill and the bottom of the display, in logical pixels. Clear
/// of the macOS Dock and the Windows taskbar at their default sizes.
const PILL_MARGIN_BOTTOM: f64 = 112.0;

fn pill_url() -> WebviewUrl {
    let origin = if cfg!(debug_assertions) {
        "http://localhost:3000"
    } else {
        "tauri://localhost"
    };
    // `parse` cannot fail on either literal above.
    WebviewUrl::External(format!("{origin}/dictation-pill.html").parse().unwrap())
}

/// Create the pill if it does not exist yet, leaving it hidden.
///
/// Called when dictation is switched on rather than on the first keypress, so
/// the webview is warm and the pill appears with the utterance instead of a
/// beat behind it.
fn build_pill(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(existing) = app.get_webview_window(PILL_LABEL) {
        return Ok(existing);
    }

    let window = WebviewWindowBuilder::new(app, PILL_LABEL, pill_url())
        .title("Dictation")
        .inner_size(PILL_WIDTH, PILL_HEIGHT)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .shadow(false)
        // The two that matter — see the module note.
        .focused(false)
        .visible(false)
        .transparent(true)
        .build()
        .map_err(|err| format!("could not create the dictation pill: {err}"))?;

    // Click-through. Without this the pill is a focus trap sitting over the
    // slide the operator is trying to click.
    if let Err(err) = window.set_ignore_cursor_events(true) {
        warn!("[dictation-pill] set_ignore_cursor_events failed: {err}");
    }

    Ok(window)
}

/// Put the pill at the bottom-centre of whichever monitor the main window is
/// on.
///
/// Positioned per show rather than once at creation: the operator may have
/// dragged Selah to another display since the last dictation, and a pill that
/// stays behind on the old one is the exact complaint the reference
/// implementation ran into.
fn position_pill(app: &AppHandle, window: &WebviewWindow) {
    let anchor = app
        .get_webview_window("main")
        .and_then(|main| main.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());

    let Some(monitor) = anchor else {
        // No monitor information — leave it wherever the OS put it rather than
        // computing a position from guesses.
        warn!("[dictation-pill] no monitor found; leaving the pill at its default position");
        return;
    };

    let scale = monitor.scale_factor();
    let position = monitor.position();
    let size = monitor.size();

    let width_px = PILL_WIDTH * scale;
    let height_px = PILL_HEIGHT * scale;
    let margin_px = PILL_MARGIN_BOTTOM * scale;

    let x = position.x as f64 + (size.width as f64 - width_px) / 2.0;
    let y = position.y as f64 + size.height as f64 - height_px - margin_px;

    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
        x: x.round() as i32,
        y: y.round() as i32,
    }));
}

/// Create the pill (hidden) so the first dictation does not pay for the
/// webview. Safe to call repeatedly.
#[tauri::command]
pub async fn ensure_dictation_pill(app: AppHandle) -> Result<(), String> {
    build_pill(&app)?;
    Ok(())
}

/// Position and show the pill.
#[tauri::command]
pub async fn show_dictation_pill(app: AppHandle) -> Result<(), String> {
    let window = build_pill(&app)?;
    position_pill(&app, &window);
    window
        .show()
        .map_err(|err| format!("could not show the dictation pill: {err}"))?;
    // `always_on_top` is reasserted on every show: another application raising
    // itself can displace it, and a pill hidden behind the browser the operator
    // is dictating into is no indicator at all.
    let _ = window.set_always_on_top(true);
    Ok(())
}

/// Hide the pill, keeping the webview for the next dictation.
#[tauri::command]
pub async fn hide_dictation_pill(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PILL_LABEL) {
        window
            .hide()
            .map_err(|err| format!("could not hide the dictation pill: {err}"))?;
    }
    Ok(())
}

/// Destroy the pill. Used when dictation is switched off — a hidden webview
/// costs memory for a feature the operator has said they are not using.
#[tauri::command]
pub async fn close_dictation_pill(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PILL_LABEL) {
        window
            .close()
            .map_err(|err| format!("could not close the dictation pill: {err}"))?;
    }
    Ok(())
}
