//! Release notes survive downloads, restarts and installation. No credentials live here.
use super::UpdateChannel;
use crate::atomic_io::write_atomic;
use serde::{Deserialize, Serialize};
use std::path::Path;

const FILE: &str = "release-notes.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNote {
    pub project: String,
    pub channel: UpdateChannel,
    pub version: String,
    pub source: String,
    pub content: String,
    pub saved_at_epoch_ms: u64,
    #[serde(default)]
    pub read: bool,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNotes {
    pub current: Option<ReleaseNote>,
    pub pending: Option<ReleaseNote>,
}

fn load(dir: &Path) -> Vec<ReleaseNote> {
    std::fs::read(dir.join(FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn same_version(a: &str, b: &str) -> bool {
    a.trim_start_matches('v') == b.trim_start_matches('v')
}

pub fn get(dir: &Path, project: &str, channel: UpdateChannel, installed: &str) -> ReleaseNotes {
    let entries = load(dir);
    ReleaseNotes {
        current: entries
            .iter()
            .find(|note| {
                note.project == project
                    && note.channel == channel
                    && same_version(&note.version, installed)
            })
            .cloned(),
        pending: entries
            .into_iter()
            .filter(|note| {
                note.project == project
                    && note.channel == channel
                    && !same_version(&note.version, installed)
            })
            .max_by_key(|note| note.saved_at_epoch_ms),
    }
}

pub fn save(dir: &Path, mut note: ReleaseNote, installed: &str) -> std::io::Result<()> {
    if note.content.trim().is_empty() {
        return Ok(());
    }
    let mut entries = load(dir);
    if let Some(existing) = entries.iter().find(|old| {
        old.project == note.project
            && old.channel == note.channel
            && same_version(&old.version, &note.version)
    }) {
        note.read = existing.read;
    }
    entries.retain(|old| {
        old.project != note.project
            || old.channel != note.channel
            || (same_version(&old.version, installed) && !same_version(&old.version, &note.version))
    });
    entries.push(note);
    write_atomic(&dir.join(FILE), &serde_json::to_vec(&entries)?)
}

pub fn mark_read(
    dir: &Path,
    project: &str,
    channel: UpdateChannel,
    version: &str,
) -> std::io::Result<()> {
    let mut entries = load(dir);
    for note in &mut entries {
        if note.project == project
            && note.channel == channel
            && same_version(&note.version, version)
        {
            note.read = true;
        }
    }
    write_atomic(&dir.join(FILE), &serde_json::to_vec(&entries)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn note(project: &str, version: &str) -> ReleaseNote {
        ReleaseNote {
            project: project.into(),
            channel: UpdateChannel::Stable,
            version: version.into(),
            source: "github".into(),
            content: "# Changes".into(),
            saved_at_epoch_ms: 1,
            read: false,
        }
    }
    #[test]
    fn archives_are_isolated_and_promote_only_the_installed_version() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), note("a", "v2"), "1").unwrap();
        save(dir.path(), note("b", "2"), "1").unwrap();
        assert!(get(dir.path(), "a", UpdateChannel::Beta, "2")
            .current
            .is_none());
        assert!(get(dir.path(), "a", UpdateChannel::Stable, "1")
            .current
            .is_none());
        mark_read(dir.path(), "a", UpdateChannel::Stable, "2").unwrap();
        save(dir.path(), note("a", "3"), "2").unwrap();
        let result = get(dir.path(), "a", UpdateChannel::Stable, "2");
        assert!(result.current.unwrap().read);
        assert_eq!(result.pending.unwrap().version, "3");
        assert!(
            !get(dir.path(), "b", UpdateChannel::Stable, "2")
                .current
                .unwrap()
                .read
        );
    }
    #[test]
    fn empty_notes_and_corrupt_or_unwritable_storage_are_safe() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), note("a", "2"), "1").unwrap();
        let mut empty = note("a", "3");
        empty.content.clear();
        save(dir.path(), empty, "1").unwrap();
        assert_eq!(
            get(dir.path(), "a", UpdateChannel::Stable, "1")
                .pending
                .unwrap()
                .version,
            "2"
        );
        std::fs::write(dir.path().join(FILE), b"broken").unwrap();
        assert!(get(dir.path(), "a", UpdateChannel::Stable, "2")
            .current
            .is_none());
        let blocked = dir.path().join("blocked");
        std::fs::write(&blocked, b"file").unwrap();
        assert!(save(&blocked, note("a", "2"), "1").is_err());
    }
}
