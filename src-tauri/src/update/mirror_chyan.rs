//! Mirror酱 `/latest` client.
//!
//! Two phases, mirroring MaaFwApp's `MirrorChyanUpdate.kt`: the check is always
//! anonymous (no CDK, so CDK problems can never surface at check time), and the
//! CDK only rides on the resolve call that returns the download URL. Business
//! codes in the response body take precedence over the HTTP status.

use serde::Deserialize;

use super::http::UpdateHttpClient;
use super::{UpdateError, UpdateFailure};

pub const MIRRORCHYAN_API_BASE: &str = "https://mirrorchyan.com/api/resources";

/// A `/latest` response payload. `url`/`sha256` are only populated by resolve.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MirrorRelease {
    pub version: String,
    pub note: Option<String>,
    pub url: Option<String>,
    pub sha256: Option<String>,
    pub size: Option<u64>,
}

/// Trims a metadata `mirrorchyan_rid`; `None` when nothing usable remains.
pub fn normalize_rid(raw: &str) -> Option<String> {
    let rid = raw.trim();
    (!rid.is_empty()).then(|| rid.to_string())
}

/// The anonymous availability check: version and release note only.
pub async fn check(
    client: &dyn UpdateHttpClient,
    rid: &str,
    channel: &str,
    current_version: &str,
) -> Result<MirrorRelease, UpdateError> {
    latest(client, rid, channel, current_version, None).await
}

/// The resolve step: sends the CDK and demands a download URL plus digest.
pub async fn resolve(
    client: &dyn UpdateHttpClient,
    rid: &str,
    channel: &str,
    current_version: &str,
    cdk: &str,
) -> Result<MirrorRelease, UpdateError> {
    let cdk = cdk.trim();
    if cdk.is_empty() {
        return Err(UpdateError::new(
            UpdateFailure::CdkRequired,
            "a MirrorChyan CDK is required to resolve the download URL",
        ));
    }
    let release = latest(client, rid, channel, current_version, Some(cdk)).await?;
    if release.url.is_none() {
        return Err(UpdateError::new(
            UpdateFailure::InvalidResponse,
            "the resolve response carried no download URL",
        ));
    }
    if release.sha256.is_none() {
        return Err(UpdateError::new(
            UpdateFailure::InvalidDigest,
            "the resolve response carried no sha256 digest",
        ));
    }
    Ok(release)
}

async fn latest(
    client: &dyn UpdateHttpClient,
    rid: &str,
    channel: &str,
    current_version: &str,
    cdk: Option<&str>,
) -> Result<MirrorRelease, UpdateError> {
    let mut url =
        url::Url::parse(&format!("{MIRRORCHYAN_API_BASE}/{rid}/latest")).map_err(|error| {
            UpdateError::new(
                UpdateFailure::Internal,
                format!("the MirrorChyan resource id is unusable: {error}"),
            )
        })?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("channel", channel);
        query.append_pair("current_version", current_version);
        query.append_pair("os", "android");
        query.append_pair("arch", "arm64");
        query.append_pair(
            "user_agent",
            &format!("MaaTauriAndroid/{} Android", crate::version::APP_VERSION),
        );
        if let Some(cdk) = cdk {
            query.append_pair("cdk", cdk);
        }
    }

    let response = client
        .get(url.as_str(), &[])
        .await
        .map_err(UpdateError::network)?;
    let envelope = match serde_json::from_slice::<MirrorEnvelope>(&response.body) {
        Ok(envelope) => envelope,
        Err(error) => {
            // A non-200 without a parsable business body is a transport problem.
            if response.status != 200 {
                return Err(UpdateError::network(format!(
                    "MirrorChyan returned HTTP {}: {error}",
                    response.status
                )));
            }
            return Err(UpdateError::new(
                UpdateFailure::InvalidResponse,
                format!("MirrorChyan returned an unparsable body: {error}"),
            ));
        }
    };
    if envelope.code != 0 {
        let failure = business_failure(envelope.code);
        // Known codes surface the upstream message verbatim; unknown codes
        // carry their number so a new business code stays diagnosable.
        let detail = match (failure, envelope.message) {
            (Some(_), Some(message)) => message,
            (_, Some(message)) => format!(
                "MirrorChyan answered with unknown business code {}: {message}",
                envelope.code
            ),
            (_, None) => {
                format!("MirrorChyan answered with business code {}", envelope.code)
            }
        };
        return Err(UpdateError::new(
            failure.unwrap_or(UpdateFailure::InvalidResponse),
            detail,
        ));
    }
    let data = envelope.data.ok_or_else(|| {
        UpdateError::new(
            UpdateFailure::InvalidResponse,
            "MirrorChyan returned no data",
        )
    })?;
    let version = data
        .version_name
        .filter(|version| !version.trim().is_empty())
        .ok_or_else(|| {
            UpdateError::new(
                UpdateFailure::InvalidResponse,
                "MirrorChyan returned no version name",
            )
        })?;
    Ok(MirrorRelease {
        version,
        note: data.release_note.filter(|note| !note.trim().is_empty()),
        url: data.url.filter(|url| !url.trim().is_empty()),
        sha256: data.sha256.filter(|digest| !digest.trim().is_empty()),
        size: data.size,
    })
}

/// Body business codes win over HTTP statuses; 7001-7005 are CDK problems
/// (only reachable via resolve), 8001-8004 are resource problems.
fn business_failure(code: i64) -> Option<UpdateFailure> {
    Some(match code {
        7001 => UpdateFailure::CdkInvalid,
        7002 => UpdateFailure::CdkExpired,
        7003 => UpdateFailure::CdkDisabled,
        7004 => UpdateFailure::CdkQuotaExceeded,
        7005 => UpdateFailure::CdkMismatch,
        8001 => UpdateFailure::ResourceNotFound,
        8002..=8004 => UpdateFailure::ResourceUnavailable,
        _ => return None,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MirrorEnvelope {
    code: i64,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    data: Option<MirrorData>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct MirrorData {
    #[serde(default, alias = "versionName")]
    version_name: Option<String>,
    #[serde(default, alias = "releaseNote")]
    release_note: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default, alias = "sha256")]
    sha256: Option<String>,
    #[serde(default)]
    size: Option<u64>,
}

#[cfg(test)]
mod tests {
    use super::super::http::testing::StubClient;
    use super::*;

    fn envelope_json(code: i64, message: &str, data: &str) -> String {
        format!(r#"{{"code": {code}, "message": "{message}", "data": {data}}}"#)
    }

    #[tokio::test]
    async fn check_is_anonymous_and_carries_the_expected_query() {
        let client = StubClient::new().with_body(
            "latest",
            200,
            envelope_json(0, "success", r#"{"version_name": "1.2.3"}"#),
        );
        let release = check(&client, "m9a", "stable", "1.0.0").await.unwrap();

        assert_eq!(release.version, "1.2.3");
        assert!(release.url.is_none());
        let requested = client.requested_urls();
        assert_eq!(requested.len(), 1);
        let url = &requested[0];
        assert!(url.contains("/resources/m9a/latest"));
        assert!(url.contains("channel=stable"));
        assert!(url.contains("current_version=1.0.0"));
        assert!(url.contains("os=android"));
        assert!(url.contains("arch=arm64"));
        assert!(url.contains(&format!(
            "user_agent=MaaTauriAndroid%2F{}",
            crate::version::APP_VERSION
        )));
        assert!(url.contains("Android"));
        assert!(!url.contains("cdk"));
    }

    #[tokio::test]
    async fn resolve_requires_a_cdk_without_touching_the_network() {
        let client = StubClient::new();
        let error = resolve(&client, "m9a", "stable", "1.0.0", "  ")
            .await
            .unwrap_err();
        assert_eq!(error.failure, UpdateFailure::CdkRequired);
        assert!(client.requested_urls().is_empty());
    }

    #[tokio::test]
    async fn resolve_returns_url_and_digest_and_sends_the_cdk() {
        let client = StubClient::new().with_body(
            "latest",
            200,
            envelope_json(
                0,
                "success",
                r#"{"version_name": "1.2.3", "url": "https://cdn.example.com/app.apk", "sha256": "abc", "size": 12}"#,
            ),
        );
        let release = resolve(&client, "m9a", "beta", "1.0.0", "secret-cdk")
            .await
            .unwrap();

        assert_eq!(
            release.url.as_deref(),
            Some("https://cdn.example.com/app.apk")
        );
        assert_eq!(release.sha256.as_deref(), Some("abc"));
        assert_eq!(release.size, Some(12));
        assert!(client.requested_urls()[0].contains("cdk=secret-cdk"));
        assert!(client.requested_urls()[0].contains("channel=beta"));
    }

    #[tokio::test]
    async fn business_codes_win_over_http_statuses() {
        // 404 + business code 8001 means "resource does not exist", not a
        // generic network problem.
        let client = StubClient::new().with_body(
            "latest",
            404,
            envelope_json(8001, "resource not found", "null"),
        );
        let error = check(&client, "m9a", "stable", "1.0.0").await.unwrap_err();
        assert_eq!(error.failure, UpdateFailure::ResourceNotFound);
        assert_eq!(error.detail, "resource not found");

        let client =
            StubClient::new().with_body("latest", 200, envelope_json(7002, "cdk expired", "null"));
        let error = check(&client, "m9a", "stable", "1.0.0").await.unwrap_err();
        assert_eq!(error.failure, UpdateFailure::CdkExpired);
    }

    #[tokio::test]
    async fn unparsable_bodies_follow_the_http_status() {
        let client = StubClient::new().with_body("latest", 502, b"<html>".to_vec());
        let error = check(&client, "m9a", "stable", "1.0.0").await.unwrap_err();
        assert_eq!(error.failure, UpdateFailure::Network);

        let client = StubClient::new().with_body("latest", 200, b"<html>".to_vec());
        let error = check(&client, "m9a", "stable", "1.0.0").await.unwrap_err();
        assert_eq!(error.failure, UpdateFailure::InvalidResponse);
    }

    #[tokio::test]
    async fn unknown_nonzero_codes_fall_back_to_invalid_response() {
        let client =
            StubClient::new().with_body("latest", 200, envelope_json(9999, "mystery", "null"));
        let error = check(&client, "m9a", "stable", "1.0.0").await.unwrap_err();
        assert_eq!(error.failure, UpdateFailure::InvalidResponse);
        assert!(error.detail.contains("9999"));
    }

    #[tokio::test]
    async fn snake_case_and_camel_case_payloads_both_parse() {
        for data in [
            r#"{"version_name": "2.0.0", "release_note": "note", "sha256": "d"}"#,
            r#"{"versionName": "2.0.0", "releaseNote": "note", "sha256": "d"}"#,
        ] {
            let client =
                StubClient::new().with_body("latest", 200, envelope_json(0, "success", data));
            let release = check(&client, "m9a", "stable", "1.0.0").await.unwrap();
            assert_eq!(release.version, "2.0.0");
            assert_eq!(release.note.as_deref(), Some("note"));
        }
    }

    #[tokio::test]
    async fn missing_version_name_is_an_invalid_response() {
        let client = StubClient::new().with_body(
            "latest",
            200,
            envelope_json(0, "success", r#"{"release_note": "note"}"#),
        );
        let error = check(&client, "m9a", "stable", "1.0.0").await.unwrap_err();
        assert_eq!(error.failure, UpdateFailure::InvalidResponse);
    }

    #[test]
    fn rid_normalization_trims_and_rejects_blank() {
        assert_eq!(normalize_rid("  m9a  "), Some("m9a".to_string()));
        assert_eq!(normalize_rid("   "), None);
    }
}
