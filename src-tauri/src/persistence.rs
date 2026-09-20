use crate::domain::types::{Project, UserConfiguration};
use crate::secrets::{
    decrypt_configuration_with_manifest, encrypt_configuration_with_manifest, SecretError,
    SecretManifest,
};
use std::fs;
use std::path::{Path, PathBuf};

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
    #[error("could not replace {path}: {source}")]
    Replace {
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
            Ok(bytes) => {
                let persisted =
                    serde_json::from_slice::<PersistedConfiguration>(&bytes).map_err(|source| {
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
        let temporary = temporary_path(&self.path);
        let mut persisted_values = configuration.clone();
        let secret_manifest = encrypt_configuration_with_manifest(project, &mut persisted_values)?;
        let bytes = serde_json::to_vec_pretty(&PersistedConfiguration {
            configuration: persisted_values,
            secret_manifest: Some(secret_manifest),
        })
        .expect("UserConfiguration must be JSON serializable");
        fs::write(&temporary, bytes).map_err(|source| PersistenceError::Write {
            path: temporary.clone(),
            source,
        })?;
        fs::rename(&temporary, &self.path).map_err(|source| PersistenceError::Replace {
            path: self.path.clone(),
            source,
        })?;
        Ok(())
    }
}

fn temporary_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|name| name.to_os_string())
        .unwrap_or_default();
    name.push(".tmp");
    path.with_file_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::types::UserConfiguration;

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
