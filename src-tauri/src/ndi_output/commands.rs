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

#[tauri::command]
pub async fn ndi_is_available(
    state: State<'_, Arc<NdiManager>>,
) -> Result<bool, String> {
    Ok(state.is_available())
}

#[tauri::command]
pub async fn ndi_get_state(
    state: State<'_, Arc<NdiManager>>,
) -> Result<NdiOutputState, String> {
    Ok(state.get_state())
}

#[cfg(feature = "ndi")]
#[tauri::command]
pub async fn ndi_start_output(
    state: State<'_, Arc<NdiManager>>,
    config: Option<NdiOutputConfig>,
) -> Result<(), String> {
    let config = config.unwrap_or_default();

    if !state.is_available() {
        return Err("NDI SDK not found. Install NDI Tools from ndi.video and restart the app.".to_string());
    }

    state.sender.start(&config)?;

    #[cfg(target_os = "macos")]
    {
        use std::sync::atomic::Ordering;
        state.capture_stop.store(true, Ordering::SeqCst);
        super::capture::start_capture(&config, state.sender.clone(), state.capture_stop.clone())?;
    }

    state.update_state(|s| {
        s.is_running = true;
        s.source_name = config.source_name.clone();
        s.error = None;
    });

    Ok(())
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
    #[cfg(target_os = "macos")]
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
    use grafton_ndi::{NDI, FinderOptions, Finder};
    use std::time::Duration;

    let ndi = NDI::new().map_err(|e| format!("Failed to initialize NDI: {:?}", e))?;

    let finder_options = FinderOptions::builder()
        .show_local_sources(true)
        .build();

    let finder = Finder::new(&ndi, &finder_options)
        .map_err(|e| format!("Failed to create NDI finder: {:?}", e))?;

    let timeout = Duration::from_secs(timeout_secs.unwrap_or(5));
    let sources = finder.find_sources(timeout)
        .map_err(|e| format!("Failed to find NDI sources: {:?}", e))?;

    Ok(sources.iter().map(|s| {
        let addr_str = match &s.address {
            grafton_ndi::SourceAddress::Ip(ip) => ip.clone(),
            grafton_ndi::SourceAddress::Url(url) => url.clone(),
            grafton_ndi::SourceAddress::None => String::new(),
        };
        super::types::NdiSourceInfo {
            name: s.name.clone(),
            address: addr_str,
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