/**
 * NDI Tauri Commands
 * 
 * Exposes NDI output functionality to the frontend.
 * Commands gracefully degrade when the NDI feature is not enabled.
 */

use std::sync::Arc;
use tauri::State;

use super::{NdiManager, NdiOutputState};
use super::types::NdiOutputConfig;

/// Prefix on the "the live output window isn't open" refusal. The frontend keys
/// off it to offer a button that opens the live output, rather than only telling
/// the operator what went wrong — most people have no reason to know NDI mirrors
/// that window, or that the order matters. Stripped before display; keep it in
/// step with `NDI_LIVE_WINDOW_MISSING` in src/hooks/useNdiOutput.ts.
#[cfg(feature = "ndi")]
pub const LIVE_WINDOW_MISSING_CODE: &str = "live-window-missing";

#[tauri::command]
pub async fn ndi_is_available(
    state: State<'_, Arc<NdiManager>>,
) -> Result<bool, String> {
    Ok(state.is_available())
}

/// Whether this build can do NDI at all — see NdiManager::is_supported.
#[tauri::command]
pub async fn ndi_is_supported(
    state: State<'_, Arc<NdiManager>>,
) -> Result<bool, String> {
    Ok(state.is_supported())
}

#[tauri::command]
pub async fn ndi_get_state(
    state: State<'_, Arc<NdiManager>>,
) -> Result<NdiOutputState, String> {
    #[allow(unused_mut)]
    let mut current = state.get_state();
    // Report what the sender has really pushed, not just what the (uncalled)
    // frontend send command counted — "running, 0 frames" is the difference
    // between NDI working and a receiver showing black.
    #[cfg(feature = "ndi")]
    {
        current.frames_sent = state.sender.frames_sent();
    }
    Ok(current)
}

#[cfg(feature = "ndi")]
#[tauri::command]
pub async fn ndi_start_output(
    state: State<'_, Arc<NdiManager>>,
    config: Option<NdiOutputConfig>,
) -> Result<(), String> {
    let config = config.unwrap_or_default();

    if !state.is_available() {
        return Err(
            "The NDI runtime could not be loaded. It ships with Selah on Windows and Linux; on \
             macOS, install NDI Tools from ndi.video/tools."
                .to_string(),
        );
    }

    // Everything below refuses BEFORE creating the sender. Announcing a source
    // we can't feed is worse than not announcing one: receivers show a black
    // frame that looks like a working feed with a blank slide.

    #[cfg(target_os = "macos")]
    if !crate::audio_capture::check_screen_capture_permission() {
        // ScreenCaptureKit is the frame source on macOS and is gated behind the
        // one-shot "Screen & System Audio Recording" TCC grant. Without it,
        // SCShareableContent returns no windows at all, so the capture loop
        // waits for a window that it can never see and not one frame is sent.
        // Note the prompt appears once ever — if it was already declined this
        // returns false immediately and System Settings is the only recovery.
        if !crate::audio_capture::request_screen_capture_permission() {
            return Err(
                "Selah needs Screen Recording permission to send the live output over NDI. \
                 Grant it in System Settings › Privacy & Security › Screen & System Audio \
                 Recording, then start NDI again."
                    .to_string(),
            );
        }
    }

    // NDI mirrors the live output window, so without that window there is
    // nothing to capture. This is the other way a "running" sender sends black.
    if let Some(app) = state.get_app() {
        use tauri::Manager;
        if app
            .get_webview_window(crate::multi_monitor::LIVE_WINDOW_LABEL)
            .is_none()
        {
            return Err(format!(
                "{LIVE_WINDOW_MISSING_CODE}: NDI sends what the live output window shows, and it \
                 isn't open yet. Send the live output to a screen, then turn NDI on."
            ));
        }
    }

    // Every platform with a capture backend is handled below. Anything else would
    // announce a source that never receives a pixel — the black feed.
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = &config; // only the capture backends read it
        return Err("NDI output has no screen capture backend on this platform.".to_string());
    }

    #[cfg(target_os = "windows")]
    if !super::capture_windows::is_supported() {
        return Err(
            "This version of Windows is too old for NDI output — Windows.Graphics.Capture \
             needs Windows 10 1903 or newer."
                .to_string(),
        );
    }

    // X11 + MIT-SHM have to be there before a sender is announced; on Wayland this
    // is where the operator is told to run under XWayland.
    #[cfg(target_os = "linux")]
    super::capture_linux::preflight()?;

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        use std::sync::atomic::Ordering;

        state.sender.start(&config)?;
        state.capture_stop.store(true, Ordering::SeqCst);

        #[cfg(target_os = "macos")]
        let started =
            super::capture::start_capture(&config, state.sender.clone(), state.capture_stop.clone());
        #[cfg(target_os = "windows")]
        let started = super::capture_windows::start_capture(
            &config,
            state.sender.clone(),
            state.capture_stop.clone(),
        );
        #[cfg(target_os = "linux")]
        let started = super::capture_linux::start_capture(
            &config,
            state.sender.clone(),
            state.capture_stop.clone(),
        );

        if let Err(e) = started {
            // Don't leave a sender announced with no capture behind it.
            state.capture_stop.store(false, Ordering::SeqCst);
            state.sender.stop();
            return Err(e);
        }

        state.update_state(|s| {
            s.is_running = true;
            s.source_name = config.source_name.clone();
            s.error = None;
        });

        Ok(())
    }
}

#[cfg(not(feature = "ndi"))]
#[tauri::command]
pub async fn ndi_start_output(
    _state: State<'_, Arc<NdiManager>>,
    _config: Option<NdiOutputConfig>,
) -> Result<(), String> {
    Err("NDI output is not available. Build with the 'ndi' feature and install the NDI SDK.".to_string())
}

#[cfg(feature = "ndi")]
#[tauri::command]
pub async fn ndi_stop_output(
    state: State<'_, Arc<NdiManager>>,
) -> Result<(), String> {
    // Signals both capture backends (the flag is "keep running") to leave their
    // loop; without this the Windows thread would keep pushing frames at a
    // destroyed sender.
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        use std::sync::atomic::Ordering;
        state.capture_stop.store(false, Ordering::SeqCst);
    }

    state.sender.stop();

    state.update_state(|s| {
        s.is_running = false;
    });

    Ok(())
}

#[cfg(not(feature = "ndi"))]
#[tauri::command]
pub async fn ndi_stop_output(
    _state: State<'_, Arc<NdiManager>>,
) -> Result<(), String> {
    Err("NDI output is not available".to_string())
}

#[cfg(feature = "ndi")]
#[tauri::command]
pub async fn ndi_send_video_frame(
    state: State<'_, Arc<NdiManager>>,
    data: Vec<u8>,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let stride = (width * 4) as i32;
    state.sender.send_frame(&data, width, height, stride)?;

    state.update_state(|s| {
        s.frames_sent += 1;
    });

    Ok(())
}

#[cfg(not(feature = "ndi"))]
#[tauri::command]
pub async fn ndi_send_video_frame(
    _state: State<'_, Arc<NdiManager>>,
    _data: Vec<u8>,
    _width: u32,
    _height: u32,
) -> Result<(), String> {
    Err("NDI output is not available".to_string())
}

/// Announce an NDI source for a channel the app renders itself (a lower-thirds or
/// other graphics feed). Idempotent for the same name.
#[cfg(feature = "ndi")]
#[tauri::command]
pub async fn ndi_push_open(
    state: State<'_, Arc<NdiManager>>,
    channel_id: String,
    source_name: String,
) -> Result<(), String> {
    if !state.is_available() {
        return Err(
            "The NDI runtime could not be loaded. It ships with Selah on Windows and Linux; on macOS, install NDI Tools from ndi.video/tools."
                .to_string(),
        );
    }
    state.push.open(&channel_id, &source_name)
}

#[cfg(not(feature = "ndi"))]
#[tauri::command]
pub async fn ndi_push_open(
    _state: State<'_, Arc<NdiManager>>,
    _channel_id: String,
    _source_name: String,
) -> Result<(), String> {
    Err("NDI output is not available".to_string())
}

#[cfg(feature = "ndi")]
#[tauri::command]
pub async fn ndi_push_close(
    state: State<'_, Arc<NdiManager>>,
    channel_id: String,
) -> Result<(), String> {
    state.push.close(&channel_id);
    Ok(())
}

#[cfg(not(feature = "ndi"))]
#[tauri::command]
pub async fn ndi_push_close(
    _state: State<'_, Arc<NdiManager>>,
    _channel_id: String,
) -> Result<(), String> {
    Ok(())
}

/// Frames sent on a pushed channel, so the UI can distinguish "announced" from
/// "actually sending" the way the program output badge does.
#[cfg(feature = "ndi")]
#[tauri::command]
pub async fn ndi_push_frames_sent(
    state: State<'_, Arc<NdiManager>>,
    channel_id: String,
) -> Result<u64, String> {
    Ok(state.push.frames_sent(&channel_id))
}

#[cfg(not(feature = "ndi"))]
#[tauri::command]
pub async fn ndi_push_frames_sent(
    _state: State<'_, Arc<NdiManager>>,
    _channel_id: String,
) -> Result<u64, String> {
    Ok(0)
}

/// One RGBA frame for a pushed channel.
///
/// Deliberately NOT a normal command with a `Vec<u8>` argument: that route
/// serialises the pixels as a JSON array of numbers, which is around 30 MB of
/// text per 1080p frame — the reason the old `ndi_send_video_frame` was never
/// usable. This takes the bytes as a raw IPC body with the frame's metadata in
/// headers, and stays synchronous because `Request` borrows the invoke message.
#[cfg(feature = "ndi")]
#[tauri::command]
pub fn ndi_push_frame(
    state: State<'_, Arc<NdiManager>>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("ndi_push_frame expects the frame as a raw binary body".to_string());
    };

    let header = |name: &str| -> Result<&str, String> {
        request
            .headers()
            .get(name)
            .ok_or_else(|| format!("missing {name} header"))?
            .to_str()
            .map_err(|_| format!("{name} header is not valid text"))
    };
    let number = |name: &str| -> Result<u32, String> {
        header(name)?
            .parse::<u32>()
            .map_err(|_| format!("{name} header is not a number"))
    };

    let channel_id = header("x-ndi-channel")?.to_string();
    let width = number("x-ndi-width")?;
    let height = number("x-ndi-height")?;

    state.push.send_frame(&channel_id, data, width, height)
}

#[cfg(not(feature = "ndi"))]
#[tauri::command]
pub fn ndi_push_frame(
    _state: State<'_, Arc<NdiManager>>,
    _request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    Err("NDI output is not available".to_string())
}

#[cfg(feature = "ndi")]
#[tauri::command]
pub async fn ndi_send_audio_frame(
    state: State<'_, Arc<NdiManager>>,
    data: Vec<f32>,
    sample_rate: u32,
    channels: u16,
    num_samples: i32,
) -> Result<(), String> {
    state.sender.send_audio(&data, sample_rate, channels, num_samples)?;

    Ok(())
}

#[cfg(not(feature = "ndi"))]
#[tauri::command]
pub async fn ndi_send_audio_frame(
    _state: State<'_, Arc<NdiManager>>,
    _data: Vec<f32>,
    _sample_rate: u32,
    _channels: u16,
    _num_samples: i32,
) -> Result<(), String> {
    Err("NDI output is not available".to_string())
}

#[cfg(feature = "ndi")]
#[tauri::command]
pub async fn ndi_discover_sources(
    _state: State<'_, Arc<NdiManager>>,
    timeout_secs: Option<u64>,
) -> Result<Vec<super::types::NdiSourceInfo>, String> {
    let lib = super::ndi_lib::NdiLib::get().ok_or(
        "The NDI runtime could not be loaded. It ships with Selah on Windows and Linux; on macOS, install NDI Tools from ndi.video/tools.",
    )?;

    let timeout_ms = (timeout_secs.unwrap_or(5) * 1000) as u32;

    Ok(lib.find_sources(timeout_ms).into_iter().map(|(name, address)| {
        super::types::NdiSourceInfo {
            name,
            address,
        }
    }).collect())
}

#[cfg(not(feature = "ndi"))]
#[tauri::command]
pub async fn ndi_discover_sources(
    _state: State<'_, Arc<NdiManager>>,
    _timeout_secs: Option<u64>,
) -> Result<Vec<super::types::NdiSourceInfo>, String> {
    Ok(vec![])
}