//! GitHub Releases source.
//!
//! Paginates the release list, filters drafts and (for the stable channel)
//! pre-releases, picks the newest parseable tag that is newer than the running
//! version, then chooses the arm64 APK asset the way MaaFwApp does: ABI marker
//! preference first, and a sha256 digest is mandatory.

use serde::Deserialize;

use super::http::UpdateHttpClient;
use super::semver::Version;
use super::{UpdateError, UpdateFailure};

/// Chrome's mobile UA: plain browser traffic, per MaaFwApp's `MiscConstants`.
pub const BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const API_BASE: &str = "https://api.github.com";
const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 3;

/// Asset-name markers that mean "this APK runs on this device", in preference
/// order. TTFlow only ships arm64 builds.
pub const ABI_TAGS: [&str; 3] = ["arm64-v8a", "arm64", "aarch64"];

/// Headers for the REST API: browser UA plus the versioned JSON accept set.
pub fn api_headers() -> Vec<(String, String)> {
    vec![
        ("User-Agent".to_string(), BROWSER_USER_AGENT.to_string()),
        (
            "Accept".to_string(),
            "application/vnd.github+json".to_string(),
        ),
        ("X-GitHub-Api-Version".to_string(), "2022-11-28".to_string()),
    ]
}

/// Headers for asset downloads from the release CDN.
pub fn download_headers() -> Vec<(String, String)> {
    vec![("User-Agent".to_string(), BROWSER_USER_AGENT.to_string())]
}

/// The chosen APK asset: download URL plus the mandatory digest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GithubRelease {
    pub version: String,
    pub note: Option<String>,
    pub url: String,
    pub sha256: String,
    pub size: Option<u64>,
}

/// Reduces a metadata `github` field (`https://github.com/owner/repo`,
/// `owner/repo.git`, `github.com/owner/repo/`, ...) to `owner/repo`.
/// `None` when nothing usable remains.
pub fn parse_repo(raw: &str) -> Option<String> {
    let mut value = raw.trim();
    for prefix in ["https://", "http://", "www.", "github.com/"] {
        if let Some(rest) = value.strip_prefix(prefix) {
            value = rest;
        }
    }
    let value = value.trim_end_matches('/');
    let value = value.strip_suffix(".git").unwrap_or(value);
    let mut parts = value.split('/');
    let owner = parts.next()?.trim();
    let repo = parts.next()?.trim();
    // A dot in the first segment means the value carried a host we did not
    // strip (GitHub owners cannot contain dots), so nothing usable remains.
    if owner.is_empty() || repo.is_empty() || owner.contains('.') {
        return None;
    }
    Some(format!("{owner}/{repo}"))
}

/// The newest applicable release, or `None` when everything published is at or
/// behind `current_version` (or the channel filters everything out).
pub async fn latest_release(
    client: &dyn UpdateHttpClient,
    repo: &str,
    channel: &str,
    current_version: &str,
) -> Result<Option<GithubRelease>, UpdateError> {
    let releases = fetch_releases(client, repo).await?;
    let current = Version::parse(current_version).ok();
    let mut best: Option<(Version, &Release)> = None;
    for release in &releases {
        if release.draft.unwrap_or(false) {
            continue;
        }
        if channel != "beta" && release.prerelease.unwrap_or(false) {
            continue;
        }
        let Ok(version) = Version::parse(release.tag_name.as_deref().unwrap_or_default()) else {
            continue;
        };
        if let Some(current) = &current {
            if version <= *current {
                continue;
            }
        }
        if best.as_ref().map_or(true, |(best, _)| version > *best) {
            best = Some((version, release));
        }
    }
    let Some((_, release)) = best else {
        return Ok(None);
    };
    let asset = pick_asset(&release.assets)?;
    let display = release.tag_name.as_deref().unwrap_or_default();
    let display = display
        .trim()
        .strip_prefix(['v', 'V'])
        .unwrap_or(display.trim());
    Ok(Some(GithubRelease {
        version: display.to_string(),
        note: release.body.clone().filter(|body| !body.trim().is_empty()),
        url: asset.browser_download_url.clone(),
        sha256: asset_digest(asset).expect("pick_asset returns digested assets"),
        size: asset.size,
    }))
}

async fn fetch_releases(
    client: &dyn UpdateHttpClient,
    repo: &str,
) -> Result<Vec<Release>, UpdateError> {
    let headers = api_headers();
    let mut all = Vec::new();
    for page in 1..=MAX_PAGES {
        let url = format!("{API_BASE}/repos/{repo}/releases?per_page={PAGE_SIZE}&page={page}");
        let response = client
            .get(&url, &headers)
            .await
            .map_err(UpdateError::network)?;
        if response.status == 404 {
            return Err(UpdateError::new(
                UpdateFailure::ResourceNotFound,
                format!("GitHub repository {repo} or its releases are unavailable (HTTP 404)"),
            ));
        }
        if response.status != 200 {
            return Err(UpdateError::network(format!(
                "GitHub returned HTTP {} for {repo}",
                response.status
            )));
        }
        let mut page_releases: Vec<Release> =
            serde_json::from_slice(&response.body).map_err(|error| {
                UpdateError::new(
                    UpdateFailure::InvalidResponse,
                    format!("GitHub returned an unparsable release list: {error}"),
                )
            })?;
        let exhausted = page_releases.is_empty();
        all.append(&mut page_releases);
        if exhausted {
            break;
        }
    }
    Ok(all)
}

/// Walks the ABI preference list; within a tag, assets without a usable digest
/// are skipped and a tag that only offers digest-less APKs fails hard, because
/// an unverifiable APK must never reach the installer.
fn pick_asset(assets: &[Asset]) -> Result<&Asset, UpdateError> {
    for tag in ABI_TAGS {
        let mut digestless = false;
        for asset in assets {
            let name = asset.name.to_lowercase();
            if !name.ends_with(".apk") || !name.contains(tag) {
                continue;
            }
            match asset_digest(asset) {
                Some(_) => return Ok(asset),
                None => digestless = true,
            }
        }
        if digestless {
            return Err(UpdateError::new(
                UpdateFailure::InvalidDigest,
                format!("the {tag} APK asset carries no usable sha256 digest"),
            ));
        }
    }
    Err(UpdateError::new(
        UpdateFailure::NoMatchingAsset,
        "no arm64 APK asset matched this device",
    ))
}

/// Accepts GitHub's `sha256:<64 hex>` asset digest form and, defensively, a
/// bare 64-hex digest. Returns the digest lowercased.
fn asset_digest(asset: &Asset) -> Option<String> {
    let digest = asset.digest.as_deref()?.trim();
    let digest = digest.strip_prefix("sha256:").unwrap_or(digest);
    let lower = digest.to_lowercase();
    (lower.len() == 64 && lower.bytes().all(|byte| byte.is_ascii_hexdigit())).then_some(lower)
}

// GitHub's REST payloads are snake_case already, so the field names below are
// the wire spellings and no rename is needed.
#[derive(Debug, Deserialize)]
struct Release {
    #[serde(default)]
    tag_name: Option<String>,
    #[serde(default)]
    prerelease: Option<bool>,
    #[serde(default)]
    draft: Option<bool>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(Debug, Deserialize)]
struct Asset {
    #[serde(default)]
    name: String,
    #[serde(default)]
    size: Option<u64>,
    #[serde(default)]
    browser_download_url: String,
    #[serde(default)]
    digest: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::super::http::testing::StubClient;
    use super::*;

    fn release_json(tag: &str, extra: &str, assets: &str) -> String {
        format!(r#"{{"tag_name": "{tag}", {extra}, "assets": [{assets}]}}"#)
    }

    fn apk_asset(name: &str, digest: Option<&str>) -> String {
        let digest = digest
            .map(|digest| format!(r#", "digest": "{digest}""#))
            .unwrap_or_default();
        format!(
            r#"{{"name": "{name}", "size": 7, "browser_download_url": "https://github.com/owner/repo/releases/download/{name}"{digest}}}"#
        )
    }

    fn digest_of(content: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        hex::encode(Sha256::digest(content))
    }

    #[test]
    fn repo_parsing_reduces_to_owner_slash_repo() {
        assert_eq!(parse_repo("owner/repo"), Some("owner/repo".to_string()));
        assert_eq!(
            parse_repo("https://github.com/owner/repo"),
            Some("owner/repo".to_string())
        );
        assert_eq!(
            parse_repo("https://github.com/owner/repo.git/"),
            Some("owner/repo".to_string())
        );
        assert_eq!(
            parse_repo("  github.com/owner/repo "),
            Some("owner/repo".to_string())
        );
        assert_eq!(parse_repo("repo-only"), None);
        assert_eq!(parse_repo("https://example.com/owner/repo"), None);
        assert_eq!(parse_repo("   "), None);
    }

    #[tokio::test]
    async fn picks_the_newest_stable_tag_and_stops_at_the_empty_page() {
        let releases = format!(
            "[{}, {}, {}]",
            release_json(
                "v1.2.0",
                r#""prerelease": false, "body": "stable note""#,
                &apk_asset(
                    "app-arm64-v8a.apk",
                    Some(&format!("sha256:{}", digest_of(b"stable"))),
                ),
            ),
            release_json(
                "v1.3.0-beta.1",
                r#""prerelease": true"#,
                &apk_asset(
                    "app-arm64-v8a.apk",
                    Some(&format!("sha256:{}", digest_of(b"apk")))
                ),
            ),
            release_json(
                "v1.1.0",
                r#""draft": true"#,
                &apk_asset(
                    "app-arm64-v8a.apk",
                    Some(&format!("sha256:{}", digest_of(b"apk")))
                ),
            ),
        );
        let client = StubClient::new()
            .with_body("page=1", 200, releases)
            .with_body("page=2", 200, "[]");

        let release = latest_release(&client, "owner/repo", "stable", "1.0.0")
            .await
            .unwrap()
            .expect("a newer release exists");

        assert_eq!(release.version, "1.2.0");
        assert_eq!(release.note.as_deref(), Some("stable note"));
        // The beta asset is unusable on the stable channel, so its digest never
        // gets picked; the empty page must have stopped pagination.
        assert_eq!(client.requested_urls().len(), 2);
    }

    #[tokio::test]
    async fn beta_channel_considers_pre_releases() {
        let releases = format!(
            "[{}]",
            release_json(
                "v1.3.0-beta.1",
                r#""prerelease": true, "body": "beta note""#,
                &apk_asset(
                    "App-arm64-v8a.APK",
                    Some(&format!("sha256:{}", digest_of(b"beta")))
                ),
            ),
        );
        let client = StubClient::new()
            .with_body("page=1", 200, releases.clone())
            .with_body("page=2", 200, "[]");

        let beta = latest_release(&client, "owner/repo", "beta", "1.0.0")
            .await
            .unwrap()
            .expect("the beta release applies");
        assert_eq!(beta.version, "1.3.0-beta.1");
        assert_eq!(beta.size, Some(7));

        // The same list on the stable channel means "nothing to do".
        let client = StubClient::new()
            .with_body("page=1", 200, releases)
            .with_body("page=2", 200, "[]");
        let stable = latest_release(&client, "owner/repo", "stable", "1.0.0")
            .await
            .unwrap();
        assert!(stable.is_none());
    }

    #[tokio::test]
    async fn tags_at_or_behind_the_running_version_are_not_updates() {
        let releases = format!(
            "[{}]",
            release_json(
                "v1.0.0",
                r#""prerelease": false"#,
                &apk_asset("app.apk", Some("x"))
            ),
        );
        let client = StubClient::new()
            .with_body("page=1", 200, releases)
            .with_body("page=2", 200, "[]");
        let release = latest_release(&client, "owner/repo", "stable", "1.0.0")
            .await
            .unwrap();
        assert!(release.is_none());
    }

    #[tokio::test]
    async fn unparsable_tags_are_skipped() {
        let releases = format!(
            "[{}, {}]",
            release_json(
                "nightly-build",
                r#""prerelease": false"#,
                &apk_asset("app.apk", Some("x"))
            ),
            release_json(
                "v0.9.0",
                r#""prerelease": false"#,
                &apk_asset(
                    "app-arm64.apk",
                    Some(&format!("sha256:{}", digest_of(b"apk")))
                ),
            ),
        );
        let client = StubClient::new()
            .with_body("page=1", 200, releases)
            .with_body("page=2", 200, "[]");
        let release = latest_release(&client, "owner/repo", "stable", "0.5.0")
            .await
            .unwrap()
            .expect("the 0.9.0 tag applies");
        assert_eq!(release.version, "0.9.0");
    }

    #[tokio::test]
    async fn assets_follow_the_abi_preference_and_demand_digests() {
        let good_digest = format!("sha256:{}", digest_of(b"arm64"));
        let fallback_digest = format!("sha256:{}", digest_of(b"fallback"));
        let releases = format!(
            "[{}]",
            release_json(
                "v2.0.0",
                r#""prerelease": false"#,
                &format!(
                    "{}, {}",
                    apk_asset("app-arm64.apk", Some(&fallback_digest)),
                    apk_asset("app-arm64-v8a.apk", Some(&good_digest)),
                ),
            ),
        );
        let client = StubClient::new()
            .with_body("page=1", 200, releases)
            .with_body("page=2", 200, "[]");
        let release = latest_release(&client, "owner/repo", "stable", "1.0.0")
            .await
            .unwrap()
            .unwrap();
        assert!(release.url.ends_with("app-arm64-v8a.apk"));
        assert_eq!(release.sha256, digest_of(b"arm64"));
    }

    #[tokio::test]
    async fn a_digestless_apk_fails_instead_of_reaching_the_installer() {
        let releases = format!(
            "[{}]",
            release_json(
                "v2.0.0",
                r#""prerelease": false"#,
                &apk_asset("app-arm64-v8a.apk", None),
            ),
        );
        let client = StubClient::new()
            .with_body("page=1", 200, releases)
            .with_body("page=2", 200, "[]");
        let error = latest_release(&client, "owner/repo", "stable", "1.0.0")
            .await
            .unwrap_err();
        assert_eq!(error.failure, UpdateFailure::InvalidDigest);
    }

    #[tokio::test]
    async fn no_matching_asset_is_its_own_failure() {
        let releases = format!(
            "[{}]",
            release_json(
                "v2.0.0",
                r#""prerelease": false"#,
                &apk_asset(
                    "app-x86_64.apk",
                    Some(&format!("sha256:{}", digest_of(b"x")))
                ),
            ),
        );
        let client = StubClient::new()
            .with_body("page=1", 200, releases)
            .with_body("page=2", 200, "[]");
        let error = latest_release(&client, "owner/repo", "stable", "1.0.0")
            .await
            .unwrap_err();
        assert_eq!(error.failure, UpdateFailure::NoMatchingAsset);
    }

    #[tokio::test]
    async fn a_missing_repository_is_resource_not_found() {
        let client = StubClient::new().with_body("page=1", 404, b"{}".to_vec());
        let error = latest_release(&client, "owner/missing", "stable", "1.0.0")
            .await
            .unwrap_err();
        assert_eq!(error.failure, UpdateFailure::ResourceNotFound);
    }

    #[test]
    fn request_headers_follow_the_documented_shape() {
        let api = api_headers();
        assert_eq!(
            api.iter()
                .find(|(name, _)| name == "User-Agent")
                .map(|(_, value)| value.as_str()),
            Some(BROWSER_USER_AGENT)
        );
        assert_eq!(
            api.iter()
                .find(|(name, _)| name == "Accept")
                .map(|(_, value)| value.as_str()),
            Some("application/vnd.github+json")
        );
        assert_eq!(
            api.iter()
                .find(|(name, _)| name == "X-GitHub-Api-Version")
                .map(|(_, value)| value.as_str()),
            Some("2022-11-28")
        );
        assert_eq!(download_headers().len(), 1);
        assert_eq!(download_headers()[0].1, BROWSER_USER_AGENT);
    }
}
