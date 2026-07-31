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
            // Off by default. Only the macOS backend can capture audio at all, and
            // asking for it turns the permission prompt into "screen and audio" —
            // a stricter grant on macOS 15 — for something a lyrics or graphics
            // feed rarely needs. Opt in per start if you want it.
            include_audio: false,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_default_values() {
        let config = NdiOutputConfig::default();
        assert_eq!(config.source_name, "Selah Live Output");
        assert!(!config.include_audio, "audio is opt-in: it widens the macOS permission prompt");
        assert_eq!(config.audio_sample_rate, 48000);
        assert_eq!(config.audio_channels, 2);
    }

    #[test]
    fn test_config_serialization_roundtrip() {
        let config = NdiOutputConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: NdiOutputConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.source_name, config.source_name);
        assert_eq!(deserialized.include_audio, config.include_audio);
        assert_eq!(deserialized.audio_sample_rate, config.audio_sample_rate);
        assert_eq!(deserialized.audio_channels, config.audio_channels);
    }

    #[test]
    fn test_config_camelcase_serialization() {
        let config = NdiOutputConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("sourceName"), "source_name should serialize as sourceName");
        assert!(json.contains("includeAudio"), "include_audio should serialize as includeAudio");
        assert!(json.contains("audioSampleRate"), "audio_sample_rate should serialize as audioSampleRate");
        assert!(json.contains("audioChannels"), "audio_channels should serialize as audioChannels");
    }

    #[test]
    fn test_source_info_serialization() {
        let info = NdiSourceInfo {
            name: "Test Source".to_string(),
            address: "192.168.1.100".to_string(),
        };
        let json = serde_json::to_string(&info).unwrap();
        let deserialized: NdiSourceInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "Test Source");
        assert_eq!(deserialized.address, "192.168.1.100");
    }
}
