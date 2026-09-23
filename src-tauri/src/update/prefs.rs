//! Update preferences: source, channel and the MirrorChyan CDK.
//!
//! Persisted as a small JSON file in the app data directory. The CDK is a
//! MirrorChyan exchange code, not an account password; MaaFwApp likewise keeps
//! it in its own plain settings storage.

use std::path::Path;

use crate::atomic_io::write_atomic;

use serde::{Deserialize, Serialize};

pub const PREFS_FILE: &str = "update-prefs.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateSource {
    Auto,
    Mirrorchyan,
    Github,
}

impl UpdateSource {
    pub fn as_str(self) -> &'static str {
        match self {
            UpdateSource::Auto => "auto",
            UpdateSource::Mirrorchyan => "mirrorchyan",
            UpdateSource::Github => "github",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateChannel {
    Stable,
    Beta,
}

impl UpdateChannel {
    /// The `channel` query value both sources understand.
    pub fn as_str(self) -> &'static str {
        match self {
            UpdateChannel::Stable => "stable",
            UpdateChannel::Beta => "beta",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdatePrefs {
    pub source: UpdateSource,
    pub channel: UpdateChannel,
    pub cdk: String,
}

impl Default for UpdatePrefs {
    fn default() -> Self {
        Self {
            source: UpdateSource::Auto,
            channel: UpdateChannel::Stable,
            cdk: String::new(),
        }
    }
}

impl UpdatePrefs {
    /// Loads the saved prefs; a missing or corrupt file means defaults.
    pub fn load(dir: &Path) -> Self {
        std::fs::read_to_string(dir.join(PREFS_FILE))
            .ok()
            .and_then(|contents| serde_json::from_str(&contents).ok())
            .unwrap_or_default()
    }

    /// Saves atomically enough for a two-line JSON file: write beside, rename.
    pub fn save(&self, dir: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(dir)?;
        let bytes = serde_json::to_vec(self).expect("prefs must serialize");
        write_atomic(&dir.join(PREFS_FILE), &bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_auto_source_stable_channel_and_no_cdk() {
        let prefs = UpdatePrefs::default();
        assert_eq!(prefs.source, UpdateSource::Auto);
        assert_eq!(prefs.channel, UpdateChannel::Stable);
        assert_eq!(prefs.cdk, "");
        assert_eq!(prefs.source.as_str(), "auto");
        assert_eq!(prefs.channel.as_str(), "stable");
    }

    #[test]
    fn prefs_round_trip_through_disk() {
        let temp = tempfile::tempdir().unwrap();
        let prefs = UpdatePrefs {
            source: UpdateSource::Github,
            channel: UpdateChannel::Beta,
            cdk: "  cdk-123  ".to_string(),
        };
        prefs.save(temp.path()).unwrap();

        let loaded = UpdatePrefs::load(temp.path());
        assert_eq!(loaded, prefs);
    }

    #[test]
    fn a_missing_file_loads_as_defaults() {
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(UpdatePrefs::load(temp.path()), UpdatePrefs::default());
    }

    #[test]
    fn a_corrupt_file_loads_as_defaults() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join(PREFS_FILE), "not json").unwrap();
        assert_eq!(UpdatePrefs::load(temp.path()), UpdatePrefs::default());

        // An unknown enum spelling fails the whole parse and falls back.
        std::fs::write(
            temp.path().join(PREFS_FILE),
            r#"{"source": "flathub", "channel": "stable", "cdk": ""}"#,
        )
        .unwrap();
        assert_eq!(UpdatePrefs::load(temp.path()), UpdatePrefs::default());
    }

    #[test]
    fn serialization_uses_camel_case_keys() {
        let json = serde_json::to_string(&UpdatePrefs {
            source: UpdateSource::Mirrorchyan,
            channel: UpdateChannel::Beta,
            cdk: "k".to_string(),
        })
        .unwrap();
        assert!(json.contains("\"source\":\"mirrorchyan\""));
        assert!(json.contains("\"channel\":\"beta\""));
        assert!(json.contains("\"cdk\":\"k\""));
    }
}
