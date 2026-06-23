//! Tauri commands for the native transcription stack.
//!
//! Model-management commands (list/download/cancel) only need [`ModelManager`],
//! which is engine-agnostic, so they compile on the default build. Engine
//! load/transcribe commands live behind the `native-transcription` feature.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
#[cfg_attr(not(feature = "native-transcription"), allow(unused_imports))]
use tauri::Manager;
use tauri::{AppHandle, State};

use super::models::{ModelManager, ModelStatus};

// ---------------------------------------------------------------------------
// LLM HTTP proxy
//
// LLM calls (model listing + chat completions) run from the webview, where most
// provider APIs reject browser-origin requests via CORS. Routing them through
// Rust (reqwest) bypasses CORS entirely. Engine-agnostic; always compiled.
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProxyRequest {
    url: String,
    /// "GET" or "POST" (default POST).
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    /// Raw request body (already-serialized JSON) for POST.
    body: Option<String>,
    /// Request timeout in seconds (default 60).
    timeout_secs: Option<u64>,
}

#[derive(serde::Serialize)]
pub struct LlmProxyResponse {
    status: u16,
    body: String,
}

/// Perform an HTTP request to an LLM provider from Rust (no CORS).
#[tauri::command]
pub async fn llm_proxy(req: LlmProxyRequest) -> Result<LlmProxyResponse, String> {
    let client = reqwest::Client::new();
    let method = req.method.as_deref().unwrap_or("POST").to_uppercase();
    let mut builder = match method.as_str() {
        "GET" => client.get(&req.url),
        _ => client.post(&req.url),
    };
    if let Some(headers) = req.headers {
        for (k, v) in headers {
            builder = builder.header(k, v);
        }
    }
    if let Some(body) = req.body {
        builder = builder.body(body);
    }
    let resp = builder
        .timeout(Duration::from_secs(req.timeout_secs.unwrap_or(60)))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| format!("Read body failed: {}", e))?;
    Ok(LlmProxyResponse { status, body })
}

/// List the catalog with per-model downloaded/downloading state.
#[tauri::command]
pub async fn list_native_models(
    manager: State<'_, Arc<ModelManager>>,
) -> Result<Vec<ModelStatus>, String> {
    Ok(manager.list_models())
}

/// Download (and extract, for Parakeet) a model. Emits `model-download-progress`.
#[tauri::command]
pub async fn download_native_model(
    app: AppHandle,
    manager: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<(), String> {
    let manager = manager.inner().clone();
    manager.download_model(&app, &model_id).await
}

/// Cancel an in-flight download.
#[tauri::command]
pub async fn cancel_native_download(
    manager: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<(), String> {
    manager.cancel_download(&model_id);
    Ok(())
}

/// Whether a model is present on disk.
#[tauri::command]
pub async fn is_native_model_downloaded(
    manager: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<bool, String> {
    Ok(manager.is_downloaded(&model_id))
}

/// Delete a downloaded model from disk.
#[tauri::command]
pub async fn delete_native_model(
    manager: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<(), String> {
    manager.delete_model(&model_id)
}

// ---------------------------------------------------------------------------
// Engine commands.
//
// These take `AppHandle` and resolve the (feature-gated) `TranscriptionManager`
// at runtime, so their signatures don't reference gated types — that keeps the
// `generate_handler!` list identical in both builds. When the feature is off
// they return a clear error.
// ---------------------------------------------------------------------------

/// Load (into the in-process engine) a previously-downloaded model.
#[tauri::command]
pub async fn load_native_model(app: AppHandle, model_id: String) -> Result<(), String> {
    #[cfg(feature = "native-transcription")]
    {
        use crate::transcription::TranscriptionManager;
        let models = app.state::<Arc<ModelManager>>();
        let info = models
            .get_model_info(&model_id)
            .ok_or_else(|| format!("Unknown model: {}", model_id))?;
        if !models.is_downloaded(&model_id) {
            return Err(format!("Model {} is not downloaded", model_id));
        }
        let path = models
            .model_path(&model_id)
            .ok_or_else(|| "Could not resolve model path".to_string())?;
        let engine_type = info.engine_type;
        let manager = app.state::<TranscriptionManager>().inner().clone();
        // Loading can take seconds (mmap + warm-up); run off the async executor.
        tauri::async_runtime::spawn_blocking(move || manager.load_model(&model_id, path, engine_type))
            .await
            .map_err(|e| format!("Load task failed: {}", e))?
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(feature = "native-transcription"))]
    {
        let _ = (&app, &model_id);
        Err("Native transcription is not enabled in this build".to_string())
    }
}

/// Unload the in-process engine (frees memory).
#[tauri::command]
pub async fn unload_native_model(app: AppHandle) -> Result<(), String> {
    #[cfg(feature = "native-transcription")]
    {
        use crate::transcription::TranscriptionManager;
        app.state::<TranscriptionManager>()
            .unload_model()
            .map_err(|e| e.to_string())
    }
    #[cfg(not(feature = "native-transcription"))]
    {
        let _ = &app;
        Ok(())
    }
}

/// The model id currently loaded into the engine, if any.
#[tauri::command]
pub async fn get_loaded_native_model(app: AppHandle) -> Result<Option<String>, String> {
    #[cfg(feature = "native-transcription")]
    {
        use crate::transcription::TranscriptionManager;
        Ok(app.state::<TranscriptionManager>().get_current_model())
    }
    #[cfg(not(feature = "native-transcription"))]
    {
        let _ = &app;
        Ok(None)
    }
}

/// Configure the engine (language / initial prompt / translate) for the session.
#[tauri::command]
pub async fn set_native_transcription_config(
    app: AppHandle,
    language: Option<String>,
    initial_prompt: Option<String>,
    translate: Option<bool>,
) -> Result<(), String> {
    #[cfg(feature = "native-transcription")]
    {
        use crate::transcription::{TranscriptionConfig, TranscriptionManager};
        app.state::<TranscriptionManager>().set_config(TranscriptionConfig {
            language,
            initial_prompt,
            translate: translate.unwrap_or(false),
        });
        Ok(())
    }
    #[cfg(not(feature = "native-transcription"))]
    {
        let _ = (&app, &language, &initial_prompt, &translate);
        Ok(())
    }
}
