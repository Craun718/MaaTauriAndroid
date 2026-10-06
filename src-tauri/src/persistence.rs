use crate::atomic_io::write_atomic;
use crate::domain::types::{Project, UserConfiguration};
use crate::secrets::{
    decrypt_configuration_with_manifest, encrypt_configuration_with_manifest, SecretError,
    SecretManifest,
};
use std::fs;
use std::path::{Path, PathBuf};

const BACKUP_PREFIX: &str = "configuration.json.backup-";
const MAX_BACKUPS: usize = 10;

#[derive(Debug, thiserror::Error)]
pub enum PersistenceError {
    #[error("could not create {path}: {source}")]
    CreateDirectory {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("could not read {path}: {source}")]
    Read {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("could not write {path}: {source}")]
    Write {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("could not parse {path}: {source}")]
    Parse {
        path: PathBuf,
        source: serde_json::Error,
    },
    #[error(transparent)]
    Secret(#[from] SecretError),
}

#[derive(Debug)]
pub struct UserConfigurationStore {
    path: PathBuf,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedConfiguration {
    #[serde(flatten)]
    configuration: crate::domain::types::UserConfiguration,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    secret_manifest: Option<SecretManifest>,
}

impl UserConfigurationStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self, project: &Project) -> Result<UserConfiguration, PersistenceError> {
        match fs::read(&self.path) {
            Ok(bytes) => match self.load_bytes(project, &bytes) {
                Ok(configuration) => Ok(configuration),
                Err(PersistenceError::Parse { source, .. }) => {
                    log::warn!(
                        "the configuration is unreadable{}; trying a backup",
                        if is_corrupt_bytes(&bytes) {
                            " (the file contains no JSON data)"
                        } else {
                            ""
                        }
                    );
                    self.restore_latest_backup(project, source)
                }
                Err(error) => Err(error),
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(UserConfiguration::default())
            }
            Err(source) => Err(PersistenceError::Read {
                path: self.path.clone(),
                source,
            }),
        }
    }

    pub fn save(
        &self,
        project: &Project,
        configuration: &UserConfiguration,
    ) -> Result<(), PersistenceError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|source| PersistenceError::CreateDirectory {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        let mut persisted_values = configuration.clone();
        let secret_manifest = encrypt_configuration_with_manifest(project, &mut persisted_values)?;
        let bytes = serde_json::to_vec_pretty(&PersistedConfiguration {
            configuration: persisted_values,
            secret_manifest: Some(secret_manifest),
        })
        .expect("UserConfiguration must be JSON serializable");
        if self.backup_current(project) {
            self.rotate_backups();
        }
        write_atomic(&self.path, &bytes).map_err(|source| PersistenceError::Write {
            path: self.path.clone(),
            source,
        })?;
        Ok(())
    }

    fn load_bytes(
        &self,
        project: &Project,
        bytes: &[u8],
    ) -> Result<UserConfiguration, PersistenceError> {
        let persisted =
            serde_json::from_slice::<PersistedConfiguration>(bytes).map_err(|source| {
                PersistenceError::Parse {
                    path: self.path.clone(),
                    source,
                }
            })?;
        let mut configuration = persisted.configuration;
        decrypt_configuration_with_manifest(
            project,
            &mut configuration,
            persisted.secret_manifest.as_ref(),
        )?;
        Ok(configuration)
    }

    fn backup_current(&self, project: &Project) -> bool {
        let Ok(bytes) = fs::read(&self.path) else {
            return false;
        };
        if self.load_bytes(project, &bytes).is_err() {
            log::warn!("skipping a configuration backup because the current file is unreadable");
            return false;
        }
        let parent = self
            .path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let today = chrono::Utc::now().format("%Y%m%d");
        let backups = backup_paths(&self.path);
        let same_day = backups.iter().any(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| {
                    name.strip_prefix(BACKUP_PREFIX)
                        .is_some_and(|stamp| stamp.starts_with(&today.to_string()))
                })
        });
        if same_day {
            return true;
        }
        let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%.3fZ");
        let backup = parent.join(format!("{BACKUP_PREFIX}{stamp}"));
        if let Err(error) = write_atomic(&backup, &bytes) {
            log::warn!("could not back up the previous configuration: {error}");
            return false;
        }
        true
    }

    fn restore_latest_backup(
        &self,
        project: &Project,
        source: serde_json::Error,
    ) -> Result<UserConfiguration, PersistenceError> {
        let backups = backup_paths(&self.path);
        if backups.is_empty() {
            return Err(PersistenceError::Parse {
                path: self.path.clone(),
                source,
            });
        }

        let quarantined = corrupt_path(&self.path);
        if let Err(error) = fs::rename(&self.path, &quarantined) {
            log::warn!(
                "could not quarantine the damaged configuration {}: {error}",
                self.path.display()
            );
            return Err(PersistenceError::Parse {
                path: self.path.clone(),
                source,
            });
        }

        for backup in backups.iter().rev() {
            let Ok(bytes) = fs::read(backup) else {
                continue;
            };
            let Ok(configuration) = self.load_bytes(project, &bytes) else {
                log::warn!(
                    "skipping the damaged configuration backup {}",
                    backup.display()
                );
                continue;
            };
            if let Err(error) = write_atomic(&self.path, &bytes) {
                log::warn!(
                    "restored {} in memory but could not replace the damaged configuration: {error}",
                    backup.display()
                );
            }
            log::warn!(
                "configuration {} was restored from {}",
                self.path.display(),
                backup.display()
            );
            return Ok(configuration);
        }

        Err(PersistenceError::Parse {
            path: quarantined,
            source,
        })
    }

    fn rotate_backups(&self) {
        let mut backups = backup_paths(&self.path);
        while backups.len() > MAX_BACKUPS {
            let oldest = backups.remove(0);
            if let Err(error) = fs::remove_file(&oldest) {
                log::warn!(
                    "could not remove the old configuration backup {}: {error}",
                    oldest.display()
                );
                break;
            }
        }
    }
}

fn backup_paths(configuration: &Path) -> Vec<PathBuf> {
    let parent = configuration
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let Ok(entries) = fs::read_dir(parent) else {
        return Vec::new();
    };
    let mut backups: Vec<_> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(BACKUP_PREFIX))
        })
        .collect();
    backups.sort();
    backups
}

fn corrupt_path(path: &Path) -> PathBuf {
    let stamp = chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default();
    path.with_file_name(format!(
        "{}.corrupt-{stamp}",
        path.file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "configuration.json".to_string())
    ))
}

fn is_corrupt_bytes(bytes: &[u8]) -> bool {
    bytes.is_empty()
        || bytes.iter().all(|byte| *byte == 0)
        || bytes.iter().all(|byte| byte.is_ascii_whitespace())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::types::UserConfiguration;
    use std::collections::BTreeMap;

    fn project() -> Project {
        Project {
            root: String::new(),
            interface_version: 1,
            name: "project".to_string(),
            label: "Project".to_string(),
            version: None,
            language: "zh_cn".to_string(),
            languages: vec!["zh_cn".to_string()],
            controllers: Vec::new(),
            resources: Vec::new(),
            groups: Vec::new(),
            setting_sections: Vec::new(),
            tasks: Vec::new(),
            options: BTreeMap::new(),
            global_options: Vec::new(),
            presets: Vec::new(),
            agents: Vec::new(),
            metadata: Default::default(),
        }
    }

    #[test]
    fn parses_legacy_and_manifest_formats() {
        let configuration = UserConfiguration::default();
        let legacy = serde_json::to_vec(&configuration).expect("legacy format should serialize");

        let legacy = serde_json::from_slice::<PersistedConfiguration>(&legacy)
            .expect("legacy format should parse");
        assert!(legacy.secret_manifest.is_none());

        let mut manifest = SecretManifest::default();
        manifest.insert(r#"["task","run","task","Login","token"]"#.to_string());
        let wrapped = serde_json::to_vec(&PersistedConfiguration {
            configuration: configuration.clone(),
            secret_manifest: Some(manifest),
        })
        .expect("manifest format should serialize");

        let wrapped =
            serde_json::from_slice::<PersistedConfiguration>(&wrapped).expect("manifest format");
        assert_eq!(
            serde_json::to_value(&wrapped.configuration).expect("configuration should serialize"),
            serde_json::to_value(&configuration).expect("configuration should serialize")
        );
        assert!(wrapped
            .secret_manifest
            .is_some_and(|manifest| manifest.contains(r#"["task","run","task","Login","token"]"#)));
    }

    #[test]
    fn saves_back_up_the_previous_generation_once_per_day() {
        let temp = tempfile::tempdir().unwrap();
        let store = UserConfigurationStore::new(temp.path().join("configuration.json"));
        let first = UserConfiguration::default();
        let second = UserConfiguration {
            initialized: true,
            ..UserConfiguration::default()
        };

        store.save(&project(), &first).unwrap();
        let first_bytes = fs::read(store.path()).unwrap();
        store.save(&project(), &second).unwrap();
        store.save(&project(), &first).unwrap();

        let backups = backup_paths(store.path());
        assert_eq!(backups.len(), 1);
        assert_eq!(fs::read(&backups[0]).unwrap(), first_bytes);
    }

    #[test]
    fn a_damaged_configuration_is_quarantined_and_restored() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("configuration.json");
        let store = UserConfigurationStore::new(path.clone());
        let first = UserConfiguration::default();
        let second = UserConfiguration {
            initialized: true,
            ..UserConfiguration::default()
        };
        store.save(&project(), &first).unwrap();
        store.save(&project(), &second).unwrap();
        let backup = backup_paths(&path).remove(0);
        fs::write(&path, [0, 0, 0]).unwrap();

        let restored = store.load(&project()).unwrap();
        assert_eq!(
            serde_json::to_value(restored).unwrap(),
            serde_json::to_value(first).unwrap()
        );
        assert_eq!(fs::read(&path).unwrap(), fs::read(&backup).unwrap());
        assert_eq!(
            fs::read_dir(temp.path())
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().contains(".corrupt-"))
                .count(),
            1
        );
    }

    #[test]
    fn backups_are_limited_to_the_newest_ten_generations() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("configuration.json");
        let store = UserConfigurationStore::new(path.clone());
        for index in 0..10 {
            let backup = temp
                .path()
                .join(format!("{BACKUP_PREFIX}20200101T0000{index:02}Z"));
            fs::write(backup, b"old backup").unwrap();
        }

        store
            .save(&project(), &UserConfiguration::default())
            .unwrap();

        let backups = backup_paths(&path);
        assert_eq!(backups.len(), 10);
        assert!(!backups
            .iter()
            .any(|path| path.ends_with("20200101T000000Z")));
    }

    #[test]
    fn detects_files_that_read_successfully_but_contain_no_data() {
        assert!(is_corrupt_bytes(&[]));
        assert!(is_corrupt_bytes(&[0, 0, 0]));
        assert!(is_corrupt_bytes(b" \n\r\t"));
        assert!(!is_corrupt_bytes(b"{\"schemaVersion\":1}"));
    }

    #[test]
    fn parses_and_validates_legacy_welcome_acknowledgement_fields() {
        let current = UserConfiguration::default();
        let mut legacy_value =
            serde_json::to_value(&current).expect("configuration should serialize");
        {
            let object = legacy_value
                .as_object_mut()
                .expect("configuration should be an object");
            object.remove("welcomeAcknowledgedAppVersion");
            object.remove("skipWelcomeAnnouncement");
        }
        let legacy = serde_json::from_slice::<PersistedConfiguration>(
            &serde_json::to_vec(&legacy_value).expect("legacy format should serialize"),
        )
        .expect("legacy welcome fields should default");
        assert_eq!(legacy.configuration.welcome_acknowledged_app_version, None);
        assert!(!legacy.configuration.skip_welcome_announcement);

        legacy_value
            .as_object_mut()
            .expect("configuration should be an object")
            .insert("skipWelcomeAnnouncement".to_string(), "yes".into());
        assert!(serde_json::from_slice::<PersistedConfiguration>(
            &serde_json::to_vec(&legacy_value).expect("invalid format should serialize")
        )
        .is_err());
    }
}
