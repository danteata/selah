/**
 * Structured Logging and Crash Detection for Selah
 *
 * Provides:
 * - File-based logging via tracing + tracing-appender with daily rotation
 * - A JS-accessible `log_message` Tauri command for bridging frontend logs
 * - A `get_logs` Tauri command to retrieve recent log lines
 * - Crash detection via sentinel file approach
 * - Daily rotation, keeps last 7 days of logs
 */

use std::fs;
use std::path::PathBuf;
use tracing::{info, warn};
use tauri::Manager;
use tracing_subscriber::prelude::*;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::fmt;

/// Guard that deletes the sentinel file on drop (clean shutdown).
pub struct SentinelGuard {
    path: PathBuf,
}

impl Drop for SentinelGuard {
    fn drop(&mut self) {
        if self.path.exists() {
            let _ = fs::remove_file(&self.path);
        }
    }
}

/// State holding the log file path for the `get_logs` command.
pub struct LogState {
    pub log_dir: PathBuf,
    pub _guard: Option<tracing_appender::non_blocking::WorkerGuard>,
}

/// Initialize file logging and return (SentinelGuard, LogState).
///
/// - Creates `{app_config_dir}/logs/` if it doesn't exist.
/// - Sets up daily-rotated log files, keeping last 7 days.
/// - Creates a sentinel file `.selah-running` in the config dir.
/// - Returns the sentinel guard (caller must hold it until app exit).
pub fn init_logging(app_config_dir: &PathBuf) -> (SentinelGuard, LogState) {
    let log_dir = app_config_dir.join("logs");
    fs::create_dir_all(&log_dir).unwrap_or_else(|e| {
        eprintln!("[logging] Failed to create log dir {:?}: {}", log_dir, e);
    });

    let file_appender = tracing_appender::rolling::daily(&log_dir, "selah");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    let subscriber = tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::layer().with_writer(std::io::stdout))
        .with(fmt::layer().with_writer(non_blocking).with_ansi(false));

    tracing::subscriber::set_global_default(subscriber)
        .expect("Failed to set tracing subscriber");

    info!("[logging] Initialized file logging in {:?}", log_dir);

    let sentinel_path = app_config_dir.join(".selah-running");
    let sentinel_guard = SentinelGuard { path: sentinel_path.clone() };
    fs::write(&sentinel_path, std::process::id().to_string())
        .unwrap_or_else(|e| warn!("[logging] Failed to write sentinel file: {}", e));
    info!("[logging] Sentinel file written to {:?}", sentinel_path);

    let log_state = LogState {
        log_dir: log_dir.clone(),
        _guard: Some(guard),
    };

    (sentinel_guard, log_state)
}

/// Check if the previous session crashed (sentinel file exists on startup).
/// Returns `Some(true)` if a crash was detected, `Some(false)` if not, `None` on error.
pub fn check_crash_detection(app_config_dir: &PathBuf) -> Option<bool> {
    let sentinel_path = app_config_dir.join(".selah-running");

    if !sentinel_path.exists() {
        info!("[crash-detection] No sentinel file — previous session shut down cleanly");
        return Some(false);
    }

    // Sentinel exists — previous session did not clean up
    let pid_str = fs::read_to_string(&sentinel_path).ok();
    warn!(
        "[crash-detection] Previous session appears to have crashed! (PID: {:?})",
        pid_str
    );

    // Clean up the stale sentinel so we don't report the same crash again
    let _ = fs::remove_file(&sentinel_path);

    Some(true)
}

/// Get the most recent log file path (for the `get_logs` command).
fn get_latest_log_file(log_dir: &PathBuf) -> Option<PathBuf> {
    let mut entries: Vec<_> = fs::read_dir(log_dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "log" || e.path().to_string_lossy().contains("selah."))
                .unwrap_or(false)
        })
        .collect();

    entries.sort_by_key(|e| e.path());
    entries.last().map(|e| e.path())
}

/// Get the last N lines from the most recent log file.
pub fn get_recent_log_lines(log_dir: &PathBuf, max_lines: usize) -> Vec<String> {
    let log_file = match get_latest_log_file(log_dir) {
        Some(path) => path,
        None => return vec!["No log file found".to_string()],
    };

    let content = match fs::read_to_string(&log_file) {
        Ok(c) => c,
        Err(e) => return vec![format!("Failed to read log file: {}", e)],
    };

    let lines: Vec<String> = content.lines().map(String::from).collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].to_vec()
}

/// Clean up old log files (keep last 7 days).
pub fn cleanup_old_logs(log_dir: &PathBuf, keep_days: u64) {
    let mut files_to_remove: Vec<PathBuf> = Vec::new();

    if let Ok(entries) = fs::read_dir(log_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Ok(metadata) = fs::metadata(&path) {
                    if let Ok(modified) = metadata.modified() {
                        let age = std::time::SystemTime::now()
                            .duration_since(modified)
                            .unwrap_or_default();
                        if age.as_secs() > keep_days * 24 * 3600 {
                            files_to_remove.push(path);
                        }
                    }
                }
            }
        }
    }

    for path in files_to_remove {
        info!("[logging] Removing old log file: {:?}", path);
        let _ = fs::remove_file(&path);
    }
}

/// Tauri command: Log a message from the JS frontend to the Rust log file.
#[tauri::command]
pub async fn log_message(
    level: String,
    message: String,
    context: Option<String>,
) -> Result<(), String> {
    let ctx = context.unwrap_or_default();
    match level.as_str() {
        "trace" => tracing::trace!("[JS] {} {}", message, ctx),
        "debug" => tracing::debug!("[JS] {} {}", message, ctx),
        "info" => tracing::info!("[JS] {} {}", message, ctx),
        "warn" => tracing::warn!("[JS] {} {}", message, ctx),
        "error" => tracing::error!("[JS] {} {}", message, ctx),
        _ => tracing::info!("[JS] {} {}", message, ctx),
    }
    Ok(())
}

/// Tauri command: Get the last N lines from the log file.
#[tauri::command]
pub async fn get_logs(
    state: tauri::State<'_, LogState>,
    max_lines: Option<usize>,
) -> Result<Vec<String>, String> {
    let n = max_lines.unwrap_or(200);
    Ok(get_recent_log_lines(&state.log_dir, n))
}

/// Tauri command: Check if the previous session crashed.
#[tauri::command]
pub async fn check_previous_crash(
    app: tauri::AppHandle,
) -> Result<bool, String> {
    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("Failed to get config dir: {}", e))?;
    Ok(check_crash_detection(&config_dir).unwrap_or(false))
}