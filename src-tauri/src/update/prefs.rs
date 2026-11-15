//! Update preferences and an Android Keystore protected GitHub token.
//!
//! Persisted as a small JSON file in the app data directory. The CDK is a
//! MirrorChyan exchange code, not an account password; MaaFwApp likewise keeps
//! it in its own plain settings storage. Only the GitHub token is encrypted.

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

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdatePrefs {
    pub source: UpdateSource,
    pub channel: UpdateChannel,
    pub cdk: String,
    pub github_token: String,
}

impl std::fmt::Debug for UpdatePrefs {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UpdatePrefs")
            .field("source", &self.source)
            .field("channel", &self.channel)
            .finish_non_exhaustive()
    }
}

impl Default for UpdatePrefs {
    fn default() -> Self {
        Self {
            source: UpdateSource::Mirrorchyan,
            channel: UpdateChannel::Stable,
            cdk: String::new(),
            github_token: String::new(),
        }
    }
}

impl UpdatePrefs {
    /// The "auto" source is legacy UI state; normalize it to MirrorChyan on
    /// every read so saved files and in-memory prefs never carry it forward.
    pub(super) fn normalized(mut self) -> Self {
        if self.source == UpdateSource::Auto {
            self.source = UpdateSource::Mirrorchyan;
        }
        self
    }

    /// Loads saved preferences and decrypts the token; missing/corrupt JSON uses defaults.
    pub fn load(dir: &Path) -> Self {
        Self::load_with(dir, crate::secrets::decrypt_credential)
    }

    fn load_with(
        dir: &Path,
        decrypt: impl FnOnce(&str) -> Result<String, crate::secrets::SecretError>,
    ) -> Self {
        let prefs: Self = std::fs::read_to_string(dir.join(PREFS_FILE))
            .ok()
            .and_then(|contents| serde_json::from_str(&contents).ok())
            .unwrap_or_default()
            .normalized();
        if !prefs.github_token.is_empty() {
            // Never treat a stored value as a plaintext credential, including
            // after a Keystore reset or when importing settings from a device.
            prefs.github_token = if prefs
                .github_token
                .starts_with(crate::secrets::ENVELOPE_PREFIX)
            {
                decrypt(&prefs.github_token).unwrap_or_default()
            } else {
                String::new()
            };
        }
        prefs
    }

    /// Saves atomically enough for a two-line JSON file: write beside, rename.
    pub fn save(&self, dir: &Path) -> std::io::Result<()> {
        self.save_with(dir, crate::secrets::encrypt_credential)
    }

    fn save_with(
        &self,
        dir: &Path,
        encrypt: impl FnOnce(&str) -> Result<String, crate::secrets::SecretError>,
    ) -> std::io::Result<()> {
        let mut stored = self.clone().normalized();
        if !stored.github_token.is_empty() {
            stored.github_token = encrypt(&stored.github_token)
                .map_err(|_| std::io::Error::other("GitHub token encryption failed"))?;
            if !stored
                .github_token
                .starts_with(crate::secrets::ENVELOPE_PREFIX)
            {
                return Err(std::io::Error::other("GitHub token encryption failed"));
            }
        }
        std::fs::create_dir_all(dir)?;
        let bytes = serde_json::to_vec(&stored).expect("prefs must serialize");
        write_atomic(&dir.join(PREFS_FILE), &bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_mirrorchyan_source_stable_channel_and_no_cdk() {
        let prefs = UpdatePrefs::default();
        assert_eq!(prefs.source, UpdateSource::Mirrorchyan);
        assert_eq!(prefs.channel, UpdateChannel::Stable);
        assert_eq!(prefs.cdk, "");
        assert_eq!(prefs.github_token, "");
        assert_eq!(prefs.source.as_str(), "mirrorchyan");
        assert_eq!(prefs.channel.as_str(), "stable");
    }

    #[test]
    fn legacy_auto_source_loads_as_mirrorchyan_without_losing_settings() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            temp.path().join(PREFS_FILE),
            r#"{"source":"auto","channel":"beta","cdk":"existing"}"#,
        )
        .unwrap();
        let prefs = UpdatePrefs::load(temp.path());
        assert_eq!(prefs.source, UpdateSource::Mirrorchyan);
        assert_eq!(prefs.channel, UpdateChannel::Beta);
        assert_eq!(prefs.cdk, "existing");
        prefs.save(temp.path()).unwrap();
        assert_eq!(UpdatePrefs::load(temp.path()), prefs);
    }

    #[test]
    fn prefs_round_trip_through_disk() {
        let temp = tempfile::tempdir().unwrap();
        let prefs = UpdatePrefs {
            source: UpdateSource::Github,
            channel: UpdateChannel::Beta,
            cdk: "  cdk-123  ".to_string(),
            ..UpdatePrefs::default()
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
            ..UpdatePrefs::default()
        })
        .unwrap();
        assert!(json.contains("\"source\":\"mirrorchyan\""));
        assert!(json.contains("\"channel\":\"beta\""));
        assert!(json.contains("\"cdk\":\"k\""));
        assert!(json.contains("\"githubToken\":\"\""));
    }
    #[test]
    fn github_token_is_encrypted_on_disk_and_decrypted_on_load() {
        let temp = tempfile::tempdir().unwrap();
        let prefs = UpdatePrefs {
            github_token: "ghp_test".into(),
            ..UpdatePrefs::default()
        };
        prefs
            .save_with(temp.path(), |value| {
                assert_eq!(value, "ghp_test");
                Ok("enc:v1:test-ciphertext".into())
            })
            .unwrap();
        let stored = std::fs::read_to_string(temp.path().join(PREFS_FILE)).unwrap();
        assert!(!stored.contains("ghp_test"));
        assert!(stored.contains("enc:v1:test-ciphertext"));
        let loaded = UpdatePrefs::load_with(temp.path(), |value| {
            assert_eq!(value, "enc:v1:test-ciphertext");
            Ok("ghp_test".into())
        });
        assert_eq!(loaded, prefs);
        assert!(!format!("{prefs:?}").contains("ghp_test"));
    }

    #[test]
    fn encryption_failure_preserves_the_previous_file() {
        let temp = tempfile::tempdir().unwrap();
        let original = UpdatePrefs::default();
        original.save(temp.path()).unwrap();
        let prefs = UpdatePrefs {
            github_token: "ghp_test".into(),
            ..original.clone()
        };
        assert!(prefs
            .save_with(temp.path(), |_| Err(
                crate::secrets::SecretError::BridgeUnavailable
            ))
            .is_err());
        assert!(prefs
            .save_with(temp.path(), |_| Ok("plaintext".into()))
            .is_err());
        assert_eq!(UpdatePrefs::load(temp.path()), original);
    }

    #[test]
    fn undecryptable_or_plaintext_tokens_are_discarded_without_losing_preferences() {
        let temp = tempfile::tempdir().unwrap();
        for token in ["enc:v1:lost-key", "ghp_plaintext"] {
            std::fs::write(
                temp.path().join(PREFS_FILE),
                format!(r#"{{"source":"github","channel":"beta","githubToken":"{token}"}}"#),
            )
            .unwrap();
            let loaded = UpdatePrefs::load_with(temp.path(), |_| {
                Err(crate::secrets::SecretError::BridgeUnavailable)
            });
            assert_eq!(loaded.source, UpdateSource::Github);
            assert_eq!(loaded.channel, UpdateChannel::Beta);
            assert!(loaded.github_token.is_empty());
        }
    }

    #[test]
    fn clearing_the_token_needs_no_keystore_and_removes_the_ciphertext() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            temp.path().join(PREFS_FILE),
            r#"{"githubToken":"enc:v1:old"}"#,
        )
        .unwrap();
        UpdatePrefs::default()
            .save_with(temp.path(), |_| {
                panic!("empty tokens must not be encrypted")
            })
            .unwrap();
        let stored = std::fs::read_to_string(temp.path().join(PREFS_FILE)).unwrap();
        assert!(!stored.contains("enc:v1:old"));
        assert_eq!(UpdatePrefs::load(temp.path()), UpdatePrefs::default());
    }

    #[test]
    fn failed_disk_write_does_not_report_success() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("not-a-directory");
        std::fs::write(&file, "occupied").unwrap();
        assert!(UpdatePrefs::default().save(&file).is_err());
    }

    #[test]
    fn old_preferences_without_a_token_remain_compatible() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            temp.path().join(PREFS_FILE),
            r#"{"source":"github","channel":"beta","cdk":"existing"}"#,
        )
        .unwrap();
        let loaded = UpdatePrefs::load(temp.path());
        assert_eq!(loaded.source, UpdateSource::Github);
        assert_eq!(loaded.channel, UpdateChannel::Beta);
        assert_eq!(loaded.cdk, "existing");
        assert!(loaded.github_token.is_empty());
    }
}
