//! Verified streaming APK download.
//!
//! Follows MaaFwApp's `OkHttpUpdateDownloader`: staged into a `.part` file, no
//! resume support, but an already-complete file whose sha256 matches the
//! expected digest is reused as-is. The staging file only reaches its final
//! name once the digest verifies, and any early exit removes it.

use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use super::github::download_headers;
use super::http::UpdateHttpClient;
use super::{UpdateError, UpdateFailure};

/// Progress is reported in whole megabytes, matching MaaFwApp's granularity.
const PROGRESS_GRANULARITY: u64 = 1024 * 1024;

#[derive(Debug)]
pub struct DownloadOutcome {
    pub path: PathBuf,
    pub bytes: u64,
}

/// Downloads `url` into `destination_dir`, verifies the sha256 `digest` and
/// returns the final path. `cancelled` short-circuits the stream between
/// chunks; `on_progress` receives `(received, total)` at megabyte granularity.
pub async fn download_apk(
    client: &dyn UpdateHttpClient,
    url: &str,
    digest: &str,
    destination_dir: &Path,
    version_label: &str,
    cancelled: &AtomicBool,
    mut on_progress: impl FnMut(u64, Option<u64>) + Send,
) -> Result<DownloadOutcome, UpdateError> {
    let Some(digest) = normalize_digest(digest) else {
        return Err(UpdateError::new(
            UpdateFailure::InvalidDigest,
            format!("the update source returned an unusable sha256 digest ({digest})"),
        ));
    };
    std::fs::create_dir_all(destination_dir)
        .map_err(|error| storage_error("create the update directory", error))?;

    let file_name = format!("ttflow-{}-{}.apk", safe_label(version_label), &digest[..16]);
    let destination = destination_dir.join(&file_name);
    let staging = destination_dir.join(format!("{file_name}.part"));

    // A previous attempt may already have verified this exact file.
    if let Ok(existing) = sha256_file(&destination) {
        if existing == digest {
            let bytes = std::fs::metadata(&destination)
                .map(|meta| meta.len())
                .unwrap_or(0);
            on_progress(bytes, Some(bytes));
            return Ok(DownloadOutcome {
                path: destination,
                bytes,
            });
        }
    }

    let guard = PartGuard {
        path: staging.clone(),
        armed: true,
    };
    let response = client
        .get_stream(url, &download_headers())
        .await
        .map_err(UpdateError::network)?;
    if cancelled.load(Ordering::Relaxed) {
        return Err(UpdateError::new(
            UpdateFailure::Cancelled,
            "the download was cancelled",
        ));
    }
    if response.status != 200 {
        return Err(UpdateError::new(
            UpdateFailure::DownloadFailed,
            format!("the download server returned HTTP {}", response.status),
        ));
    }

    let file = std::fs::File::create(&staging)
        .map_err(|error| storage_error("create the staging file", error))?;
    let mut writer = std::io::BufWriter::new(file);
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut next_report = PROGRESS_GRANULARITY;
    let mut stream = response.body;
    loop {
        if cancelled.load(Ordering::Relaxed) {
            return Err(UpdateError::new(
                UpdateFailure::Cancelled,
                "the download was cancelled",
            ));
        }
        let Some(chunk) = stream.recv().await else {
            break;
        };
        let chunk = chunk
            .map_err(|error| UpdateError::new(UpdateFailure::DownloadFailed, error.to_string()))?;
        std::io::Write::write_all(&mut writer, &chunk)
            .map_err(|error| storage_error("write the staging file", error))?;
        hasher.update(&chunk);
        received += chunk.len() as u64;
        if received >= next_report {
            next_report = received + PROGRESS_GRANULARITY;
            on_progress(received, response.content_length);
        }
    }
    std::io::Write::flush(&mut writer)
        .map_err(|error| storage_error("finish the staging file", error))?;
    drop(writer);
    on_progress(received, response.content_length.or(Some(received)));

    if let Some(total) = response.content_length {
        if received != total {
            return Err(UpdateError::new(
                UpdateFailure::DownloadFailed,
                format!("the download stream ended early ({received}/{total} bytes)"),
            ));
        }
    }
    let actual = hex::encode(hasher.finalize());
    if actual != digest {
        return Err(UpdateError::new(
            UpdateFailure::InvalidDigest,
            format!("the downloaded APK digest {actual} does not match the expected {digest}"),
        ));
    }

    guard.disarm();
    std::fs::rename(&staging, &destination)
        .map_err(|error| storage_error("move the downloaded APK into place", error))?;
    Ok(DownloadOutcome {
        path: destination,
        bytes: received,
    })
}

/// Deletes its staging file on drop unless disarmed, so an aborted or failed
/// attempt never leaves `.part` litter behind.
struct PartGuard {
    path: PathBuf,
    armed: bool,
}

impl PartGuard {
    fn disarm(mut self) {
        self.armed = false;
    }
}

impl Drop for PartGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// Normalizes `sha256:<64 hex>` or bare 64-hex digests to lowercase hex.
pub(crate) fn normalize_digest(digest: &str) -> Option<String> {
    let trimmed = digest.trim();
    let digest = match trimmed.get(..7) {
        Some(prefix) if prefix.eq_ignore_ascii_case("sha256:") => &trimmed[7..],
        _ => trimmed,
    };
    let lower = digest.to_lowercase();
    (lower.len() == 64 && lower.bytes().all(|byte| byte.is_ascii_hexdigit())).then_some(lower)
}

fn safe_label(label: &str) -> String {
    let safe: String = label
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect();
    if safe.is_empty() {
        "unknown".to_string()
    } else {
        safe
    }
}

fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)?;
    Ok(hex::encode(hasher.finalize()))
}

fn storage_error(action: &str, error: std::io::Error) -> UpdateError {
    UpdateError::new(
        UpdateFailure::Storage,
        format!("could not {action}: {error}"),
    )
}

#[cfg(test)]
mod tests {
    use super::super::http::testing::{StreamSpec, StubClient};
    use super::*;

    fn digest_of(content: &[u8]) -> String {
        hex::encode(Sha256::digest(content))
    }

    fn stream_spec(chunks: Vec<Vec<u8>>) -> StreamSpec {
        StreamSpec {
            status: 200,
            content_length: Some(chunks.iter().map(|chunk| chunk.len() as u64).sum()),
            chunks: chunks.into_iter().map(Ok).collect(),
        }
    }

    #[tokio::test]
    async fn downloads_verifies_and_renames_into_place() {
        let temp = tempfile::tempdir().unwrap();
        let client = StubClient::new().with_stream(
            "apk",
            stream_spec(vec![b"hello".to_vec(), b" world".to_vec()]),
        );
        let cancelled = AtomicBool::new(false);

        let outcome = download_apk(
            &client,
            "https://cdn.test/app.apk",
            &digest_of(b"hello world"),
            temp.path(),
            "1.2.3",
            &cancelled,
            |_, _| {},
        )
        .await
        .unwrap();

        assert_eq!(outcome.bytes, 11);
        let saved = std::fs::read(&outcome.path).unwrap();
        assert_eq!(saved, b"hello world");
        assert!(outcome
            .path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("ttflow-1.2.3-"));
        // No staging litter remains.
        let leftovers: Vec<_> = std::fs::read_dir(temp.path())
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".part"))
            .collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
    }

    #[tokio::test]
    async fn a_digest_mismatch_discards_the_staging_file() {
        let temp = tempfile::tempdir().unwrap();
        let client = StubClient::new().with_stream("apk", stream_spec(vec![b"tampered".to_vec()]));
        let cancelled = AtomicBool::new(false);

        let error = download_apk(
            &client,
            "https://cdn.test/app.apk",
            &digest_of(b"expected"),
            temp.path(),
            "1.2.3",
            &cancelled,
            |_, _| {},
        )
        .await
        .unwrap_err();

        assert_eq!(error.failure, UpdateFailure::InvalidDigest);
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn a_truncated_stream_fails_as_download_failed() {
        let temp = tempfile::tempdir().unwrap();
        let mut spec = stream_spec(vec![b"partial".to_vec()]);
        spec.content_length = Some(100);
        let client = StubClient::new().with_stream("apk", spec);
        let cancelled = AtomicBool::new(false);

        let error = download_apk(
            &client,
            "https://cdn.test/app.apk",
            &digest_of(b"partial"),
            temp.path(),
            "1.2.3",
            &cancelled,
            |_, _| {},
        )
        .await
        .unwrap_err();

        assert_eq!(error.failure, UpdateFailure::DownloadFailed);
        assert!(error.detail.contains("ended early"));
    }

    #[tokio::test]
    async fn a_stream_io_error_discards_the_staging_file() {
        let temp = tempfile::tempdir().unwrap();
        let spec = StreamSpec {
            status: 200,
            content_length: None,
            chunks: vec![
                Ok(b"good".to_vec()),
                Err(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    "broken pipe",
                )),
            ],
        };
        let client = StubClient::new().with_stream("apk", spec);
        let cancelled = AtomicBool::new(false);

        let error = download_apk(
            &client,
            "https://cdn.test/app.apk",
            &digest_of(b"good"),
            temp.path(),
            "1.2.3",
            &cancelled,
            |_, _| {},
        )
        .await
        .unwrap_err();

        assert_eq!(error.failure, UpdateFailure::DownloadFailed);
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn cancellation_stops_before_installing_anything() {
        let temp = tempfile::tempdir().unwrap();
        let client = StubClient::new().with_stream("apk", stream_spec(vec![b"payload".to_vec()]));
        let cancelled = AtomicBool::new(true);

        let error = download_apk(
            &client,
            "https://cdn.test/app.apk",
            &digest_of(b"payload"),
            temp.path(),
            "1.2.3",
            &cancelled,
            |_, _| {},
        )
        .await
        .unwrap_err();

        assert_eq!(error.failure, UpdateFailure::Cancelled);
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn an_already_verified_file_is_reused_without_the_network() {
        let temp = tempfile::tempdir().unwrap();
        let destination = temp
            .path()
            .join(format!("ttflow-1.2.3-{}.apk", &digest_of(b"cached")[..16]));
        std::fs::write(&destination, b"cached").unwrap();
        // No scripted stream: any network attempt would fail the test.
        let client = StubClient::new();
        let cancelled = AtomicBool::new(false);
        let mut progress = Vec::new();

        let outcome = download_apk(
            &client,
            "https://cdn.test/app.apk",
            &digest_of(b"cached"),
            temp.path(),
            "1.2.3",
            &cancelled,
            |received, total| progress.push((received, total)),
        )
        .await
        .unwrap();

        assert_eq!(outcome.path, destination);
        assert_eq!(outcome.bytes, 6);
        assert_eq!(progress, vec![(6, Some(6))]);
        assert!(client.requested_urls().is_empty());
    }

    #[tokio::test]
    async fn an_unusable_digest_fails_before_any_network_or_disk_work() {
        let temp = tempfile::tempdir().unwrap();
        let client = StubClient::new();
        let cancelled = AtomicBool::new(false);

        for digest in ["", "xyz", "sha256:short"] {
            let error = download_apk(
                &client,
                "https://cdn.test/app.apk",
                digest,
                temp.path(),
                "1.2.3",
                &cancelled,
                |_, _| {},
            )
            .await
            .unwrap_err();
            assert_eq!(error.failure, UpdateFailure::InvalidDigest);
        }
        assert!(client.requested_urls().is_empty());
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
    }

    #[test]
    fn digest_normalization_is_lenient_about_prefix_and_case() {
        let digest = digest_of(b"x");
        assert_eq!(normalize_digest(&digest), Some(digest.clone()));
        assert_eq!(
            normalize_digest(&digest.to_uppercase()),
            Some(digest.clone())
        );
        assert_eq!(
            normalize_digest(&format!("SHA256:{}", digest.to_uppercase())),
            Some(digest)
        );
        assert_eq!(normalize_digest("nothex"), None);
        assert_eq!(normalize_digest(""), None);
    }

    #[test]
    fn labels_are_reduced_to_filesystem_safe_text() {
        assert_eq!(safe_label("1.2.3-beta.1"), "1.2.3-beta.1");
        assert_eq!(safe_label("v1/2\\3"), "v1_2_3");
        assert_eq!(safe_label("  "), "unknown");
    }
}
