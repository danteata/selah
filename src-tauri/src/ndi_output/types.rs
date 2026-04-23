/**
 * NDI Output Types
 */
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdiOutputConfig {
    pub source_name: String,
    pub include_audio: bool,
    pub audio_sample_rate: u32,
    pub audio_channels: u32,
}

impl Default for NdiOutputConfig {
    fn default() -> Self {
        Self {
            source_name: "Selah Live Output".to_string(),
            include_audio: true,
            audio_sample_rate: 48000,
            audio_channels: 2,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdiSourceInfo {
    pub name: String,
    pub address: String,
}
