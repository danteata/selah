//! Which models can't stream live on this computer, remembered across restarts.
//!
//! When a live stream can't keep up, the engine stops streaming for that model
//! (`streaming_unusable`). That used to last only until the next model load, so
//! every restart, and every session that loaded the model again, opened a
//! stream that stalled the first utterance and starved batch transcription
//! while it did. On a Core Ultra 7 255H transcribing on the CPU, Parakeet
//! Unified's stream fell 94 s behind and a whole sermon came out with no words.
//!
//! The memory is per app version: a later release may stream faster, so it
//! gets one fresh try.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

const FILE_NAME: &str = "streaming-unusable.json";

#[derive(Default, Serialize, Deserialize)]
struct Memory {
    /// Model id → the app version it failed to stream on.
    #[serde(default)]
    unusable: BTreeMap<String, String>,
}

fn read(dir: &Path) -> Memory {
    fs::read_to_string(dir.join(FILE_NAME))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Whether `model_id` failed to stream on this computer with this app version.
pub fn is_unusable(dir: &Path, model_id: &str, app_version: &str) -> bool {
    read(dir).unusable.get(model_id).map(String::as_str) == Some(app_version)
}

/// Remember that `model_id` can't stream here, on this app version.
pub fn remember_unusable(dir: &Path, model_id: &str, app_version: &str) -> std::io::Result<()> {
    let mut memory = read(dir);
    memory.unusable.insert(model_id.to_string(), app_version.to_string());
    fs::create_dir_all(dir)?;
    let text = serde_json::to_string_pretty(&memory).map_err(std::io::Error::other)?;
    fs::write(dir.join(FILE_NAME), text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("selah-streaming-memory-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn remembers_a_model_that_could_not_stream_until_the_next_version() {
        let dir = temp_dir("remember");
        assert!(!is_unusable(&dir, "parakeet-unified-en-0.6b", "0.1.42"));
        remember_unusable(&dir, "parakeet-unified-en-0.6b", "0.1.42").unwrap();
        assert!(is_unusable(&dir, "parakeet-unified-en-0.6b", "0.1.42"));
        // Another model, or a later release, gets its own try.
        assert!(!is_unusable(&dir, "moonshine-streaming-small", "0.1.42"));
        assert!(!is_unusable(&dir, "parakeet-unified-en-0.6b", "0.1.43"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn treats_a_missing_or_damaged_file_as_nothing_remembered() {
        let dir = temp_dir("damaged");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(FILE_NAME), "{ not json").unwrap();
        assert!(!is_unusable(&dir, "parakeet-unified-en-0.6b", "0.1.42"));
        remember_unusable(&dir, "parakeet-unified-en-0.6b", "0.1.42").unwrap();
        assert!(is_unusable(&dir, "parakeet-unified-en-0.6b", "0.1.42"));
        let _ = fs::remove_dir_all(&dir);
    }
}
