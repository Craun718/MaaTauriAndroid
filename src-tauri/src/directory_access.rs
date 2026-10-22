//! Optional directory evidence is collected by the process that accesses it.
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

pub const MARKER: &str = "MTA_DIRECTORY_ACCESS=";

#[derive(Debug, Serialize, Deserialize, thiserror::Error)]
pub struct AccessFailure {
    pub scope: String,
    pub operation: String,
    pub path: String,
    pub kind: String,
    pub error: String,
    pub errno: Option<i32>,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
    pub parent: Option<serde_json::Value>,
    pub mount: Option<Mount>,
}

impl std::fmt::Display for AccessFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "{MARKER}{}",
            serde_json::to_string(self).map_err(|_| std::fmt::Error)?
        )
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Mount {
    point: String,
    fs: String,
    options: String,
}

fn mount_for(path: &Path, contents: &str) -> Option<Mount> {
    contents
        .lines()
        .filter_map(|line| {
            let (fields, filesystem) = line.split_once(" - ")?;
            let fields: Vec<_> = fields.split_whitespace().collect();
            let filesystem: Vec<_> = filesystem.split_whitespace().collect();
            let point = fields
                .get(4)?
                .replace("\\040", " ")
                .replace("\\011", "\t")
                .replace("\\012", "\n")
                .replace("\\134", "\\");
            if !path.starts_with(&point) {
                return None;
            }
            Some(Mount {
                point,
                fs: filesystem.first()?.to_string(),
                options: format!("{},{}", fields.get(5)?, filesystem.get(2)?),
            })
        })
        .max_by_key(|mount| mount.point.len())
}

fn failure(scope: &str, path: &Path, operation: &str, error: std::io::Error) -> AccessFailure {
    let kind = match error.kind() {
        std::io::ErrorKind::PermissionDenied => "permission",
        std::io::ErrorKind::ReadOnlyFilesystem => "readOnly",
        std::io::ErrorKind::StorageFull | std::io::ErrorKind::QuotaExceeded => "noSpace",
        std::io::ErrorKind::NotADirectory | std::io::ErrorKind::AlreadyExists => "notDirectory",
        _ => "unknown",
    };
    // /proc is optional, including on non-Linux desktop targets.
    let status = fs::read_to_string("/proc/self/status").unwrap_or_default();
    let id = |label: &str| {
        status.lines().find_map(|line| {
            line.strip_prefix(label)?
                .split_whitespace()
                .nth(1)?
                .parse::<u32>()
                .ok()
        })
    };
    #[cfg(unix)]
    let parent = {
        use std::os::unix::fs::MetadataExt;
        path.ancestors().find_map(|parent| {
            let metadata = fs::metadata(parent).ok()?;
            Some(serde_json::json!({"path": parent, "uid": metadata.uid(), "gid": metadata.gid(), "mode": metadata.mode()}))
        })
    };
    #[cfg(not(unix))]
    let parent = None;
    let mount = fs::read_to_string("/proc/self/mountinfo")
        .ok()
        .and_then(|contents| mount_for(path, &contents));
    AccessFailure {
        scope: scope.to_string(),
        operation: operation.to_string(),
        path: path.to_string_lossy().into_owned(),
        kind: kind.to_string(),
        error: error.to_string(),
        errno: error.raw_os_error(),
        uid: id("Uid:"),
        gid: id("Gid:"),
        parent,
        mount,
    }
}

/// Creates only the requested app-owned directory and uses an exclusive random
/// probe. Optional log failures are warnings at the caller, never run blockers.
pub fn probe(scope: &str, directory: &Path) -> Result<(), AccessFailure> {
    fs::create_dir_all(directory)
        .map_err(|error| failure(scope, directory, "createDirectory", error))?;
    let path = directory.join(format!(".mta-probe-{}", uuid::Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| failure(scope, directory, "createProbe", error))?;
    let result = (|| -> std::io::Result<()> {
        file.write_all(b"MTA")?;
        file.seek(SeekFrom::Start(0))?;
        let mut read = [0; 3];
        file.read_exact(&mut read)?;
        if read != *b"MTA" {
            return Err(std::io::Error::other("directory probe read-back mismatch"));
        }
        Ok(())
    })();
    drop(file);
    let _ = fs::remove_file(&path);
    result.map_err(|error| failure(scope, directory, "writeReadProbe", error))
}

/// A Binder/JNI error can wrap the marker in other diagnostic text. Decode one
/// JSON value without treating unrelated errors as storage failures.
pub fn extract(message: &str) -> Option<AccessFailure> {
    let (_, json) = message.split_once(MARKER)?;
    let mut values = serde_json::Deserializer::from_str(json).into_iter::<AccessFailure>();
    let failure = values.next()?.ok()?;
    if !matches!(failure.scope.as_str(), "agentRuntime" | "maaLogs") {
        return None;
    }
    Some(failure)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_cleans_up_and_reports_a_file_in_place_of_a_directory() {
        let root = std::env::temp_dir().join(format!("mta-probe-test-{}", uuid::Uuid::new_v4()));
        probe("maaLogs", &root).unwrap();
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        fs::write(root.join("file"), b"existing").unwrap();
        let error = probe("maaLogs", &root.join("file/child")).unwrap_err();
        assert_eq!(error.operation, "createDirectory");
        assert_eq!(error.kind, "notDirectory");
        assert_eq!(fs::read(root.join("file")).unwrap(), b"existing");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn mount_uses_path_boundaries_and_decodes_spaces() {
        let contents = "1 0 0:1 / / rw - rootfs rootfs rw\n2 1 0:2 / /data rw - ext4 /dev/a rw\n3 2 0:3 / /data/local\\040tmp ro - tmpfs tmpfs ro\nbad";
        assert_eq!(
            mount_for(Path::new("/data/local tmp/a"), contents)
                .unwrap()
                .point,
            "/data/local tmp"
        );
        assert_eq!(
            mount_for(Path::new("/database"), contents).unwrap().point,
            "/"
        );
        assert!(mount_for(Path::new("/a"), "bad").is_none());
    }

    #[test]
    fn wrapped_binder_payloads_survive_but_malformed_and_unrelated_errors_do_not() {
        let payload = r#"{"scope":"agentRuntime","operation":"probe","path":"/runtime","kind":"permission","error":"denied","errno":13,"uid":2000,"gid":2000}"#;
        let error = extract(&format!(
            "Maa error: java.lang.IllegalStateException: {MARKER}{payload} trailing"
        ))
        .unwrap();
        assert_eq!(error.kind, "permission");
        assert_eq!(error.uid, Some(2000));
        assert_eq!(extract(&error.to_string()).unwrap().path, "/runtime");
        assert!(extract("ordinary error").is_none());
        assert!(extract(&format!("{MARKER}{{bad")).is_none());
        assert!(extract(&format!(
            "{MARKER}{}",
            payload.replace("agentRuntime", "other")
        ))
        .is_none());
    }

    #[test]
    fn classifies_confirmed_errors_without_assuming_permission_failure() {
        for (kind, expected) in [
            (std::io::ErrorKind::PermissionDenied, "permission"),
            (std::io::ErrorKind::ReadOnlyFilesystem, "readOnly"),
            (std::io::ErrorKind::StorageFull, "noSpace"),
            (std::io::ErrorKind::QuotaExceeded, "noSpace"),
            (std::io::ErrorKind::Other, "unknown"),
        ] {
            assert_eq!(
                failure(
                    "maaLogs",
                    Path::new("/missing"),
                    "probe",
                    std::io::Error::from(kind)
                )
                .kind,
                expected
            );
        }
    }
}
