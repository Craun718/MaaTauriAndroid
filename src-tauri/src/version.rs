//! Version and environment reporting.
//!
//! Two different notions of "the MaaFramework version" exist and both are worth
//! logging: [`MAA_FRAMEWORK_VERSION`] is the release the vendored `.so` files were
//! downloaded from (a build-time pin), while `maa_framework::maa_version()` asks the
//! loaded library at runtime. They should agree, and when they do not, comparing the
//! two lines is what shows it.
//!
//! The banner shape intentionally mirrors MaaFwApp's startup banner so a log excerpt
//! pasted from either client reads the same way.

use serde::{Deserialize, Serialize};

/// MaaFramework release the Android libraries were vendored from, resolved by
/// `build.rs` out of `scripts/env.sh` (environment variable wins when set).
pub const MAA_FRAMEWORK_VERSION: &str = env!("MAAFW_VERSION");

/// This application's version, from `Cargo.toml`.
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Tag HEAD was built from, resolved by `build.rs`; a checkout with no tag on
/// HEAD falls back to the short commit hash.
pub const APP_TAG: &str = env!("MTA_APP_TAG");

/// Tag (or short commit hash) of the `resource/m9a` Project Interface checkout.
/// Empty when the submodule is absent, so consumers hide the row.
pub const RESOURCE_TAG: &str = env!("MTA_RESOURCE_TAG");

/// The application's formal name (`productName` in `tauri.conf.json`). The
/// same name is used throughout the application and user-facing surfaces.
pub const APP_NAME: &str = "MaaTauriAndroid";

/// Placeholder used whenever a version is genuinely unknown, matching MaaFwApp.
pub const UNKNOWN: &str = "unknown";

/// Device facts only the Android shell can read. `None` on desktop and before the
/// JNI bridge has been attached.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentInfo {
    pub time: String,
    pub device: String,
    pub android: String,
    pub sdk_int: i32,
    pub abi: String,
    pub version_name: String,
    pub version_code: i64,
    pub build_type: String,
}

impl EnvironmentInfo {
    pub fn parse(json: &str) -> Option<Self> {
        serde_json::from_str(json).ok()
    }
}

/// One padded `Label : value` row; the label width matches the longest name in
/// the block (`MaaTauriAndroid`) so the rows line up.
fn row(label: &str, value: impl std::fmt::Display) -> String {
    format!("{label:<15}: {value}")
}

/// The startup banner: one block naming the client, the framework pin, and the
/// device, written once into the application log.
///
/// The header carries the package name so the whole block survives the diagnostic
/// logcat filter (`filtered_maa_tauri_android_log`), which keeps a multi-line record
/// only when one of its lines names the app.
pub fn banner(environment: Option<&EnvironmentInfo>) -> String {
    let divider = "=".repeat(60);
    let mut lines = vec![divider.clone(), format!("=== {APP_NAME} Startup ===")];
    match environment {
        Some(env) => lines.push(row("Startup time", &env.time)),
        None => lines.push(row("Startup time", UNKNOWN)),
    }
    lines.push(row(APP_NAME, APP_VERSION));
    lines.push(row("Framework", MAA_FRAMEWORK_VERSION));
    match environment {
        Some(env) => {
            lines.push(row(
                "Version",
                format!(
                    "{} ({}) {}",
                    env.version_name, env.version_code, env.build_type
                ),
            ));
            lines.push(row("Device", &env.device));
            lines.push(row(
                "Android",
                format!("{} (API {})", env.android, env.sdk_int),
            ));
            lines.push(row("ABI", &env.abi));
        }
        None => lines.push(row("Device", UNKNOWN)),
    }
    lines.push(divider);
    lines.join("\n")
}

/// Rows appended to the exported device snapshot, so an exported bundle names the
/// exact client and framework build beside the device it came from rather than
/// relying on logcat having been captured intact.
pub fn device_info_rows() -> String {
    format!(
        "{}\n{}\n",
        row(APP_NAME, APP_VERSION),
        row("Framework", MAA_FRAMEWORK_VERSION)
    )
}

/// One line naming the loaded Project Interface and its active resource.
///
/// The resource version *is* the project version: a resource pack lives inside the
/// Project Interface and `interface.json` carries the single `version` field, so
/// naming the resource here identifies which resource build a run used.
pub fn project_line(
    name: &str,
    version: Option<&str>,
    interface_version: u8,
    resource: Option<&str>,
) -> String {
    format!(
        "Project loaded: {name} ({}) on interface v{interface_version}, resource: {}",
        version.unwrap_or("unknown"),
        resource.unwrap_or("none")
    )
}

/// Device and package facts, read from the Android shell. `None` on desktop or
/// before the JNI bridge has been attached.
#[cfg(target_os = "android")]
pub fn environment() -> Option<EnvironmentInfo> {
    let json = crate::diagnostics::bridge_string("environmentInfo").ok()?;
    EnvironmentInfo::parse(&json)
}

#[cfg(not(target_os = "android"))]
pub fn environment() -> Option<EnvironmentInfo> {
    None
}

/// What the About and version cards need from the shell: the two versions only
/// this crate knows, the git identities `build.rs` resolved, and the device the
/// shell runs on. The loaded Project Interface's `label` already rides on the
/// snapshot's `project`, so it is not duplicated here.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub app_version: String,
    pub framework_version: String,
    /// Tag HEAD was built from, or the short commit hash when there is none.
    pub app_tag: String,
    /// Tag (or short commit hash) of the `resource/m9a` checkout.
    pub resource_tag: Option<String>,
    pub environment: Option<EnvironmentInfo>,
}

impl VersionInfo {
    pub fn new(environment: Option<EnvironmentInfo>) -> Self {
        Self {
            app_version: APP_VERSION.to_string(),
            framework_version: MAA_FRAMEWORK_VERSION.to_string(),
            app_tag: APP_TAG.to_string(),
            resource_tag: (!RESOURCE_TAG.is_empty()).then(|| RESOURCE_TAG.to_string()),
            environment,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// The point of the `build.rs` parser is that the compiled-in pin tracks
    /// `scripts/env.sh`. Re-read the file here so a divergence fails a test rather
    /// than silently shipping a wrong version.
    #[test]
    fn compiled_framework_version_matches_scripts_env_sh() {
        let Ok(contents) = std::fs::read_to_string(env_sh_path()) else {
            // Built from a packaged copy without the repository around it.
            return;
        };
        let expected = contents
            .lines()
            .find_map(|line| {
                let rest = line.trim().strip_prefix("MAAFW_VERSION=")?;
                let rest = rest.trim().trim_matches(['"', '\'']);
                let value = rest
                    .strip_prefix("${MAAFW_VERSION:-")
                    .map(|inner| inner.trim_end_matches('}'))
                    .unwrap_or(rest);
                Some(value.trim().to_string())
            })
            .expect("scripts/env.sh declares MAAFW_VERSION");
        assert_eq!(MAA_FRAMEWORK_VERSION, expected);
    }

    #[test]
    fn banner_reports_both_versions_and_the_device() {
        let environment = EnvironmentInfo {
            time: "2026-01-02 03:04:05.006".to_string(),
            device: "Google Pixel 9".to_string(),
            android: "16".to_string(),
            sdk_int: 36,
            abi: "arm64-v8a".to_string(),
            version_name: APP_VERSION.to_string(),
            version_code: 1000,
            build_type: "debug".to_string(),
        };

        let banner = banner(Some(&environment));

        assert!(banner.contains(&row(APP_NAME, APP_VERSION)));
        assert!(banner.contains(&row("Framework", MAA_FRAMEWORK_VERSION)));
        assert!(banner.contains(&row("Startup time", "2026-01-02 03:04:05.006")));
        assert!(banner.contains("Google Pixel 9"));
        assert!(banner.contains(&row("Android", "16 (API 36)")));
        assert!(banner.contains("arm64-v8a"));
        assert!(banner.contains(&row(
            "Version",
            format!("{} (1000) debug", environment.version_name)
        )));
    }

    #[test]
    fn banner_survives_the_logcat_filter() {
        // The diagnostic log filter keeps a multi-line record only when it names the
        // app, so the header must carry the package name.
        let banner = banner(None);
        assert!(banner.contains("MaaTauriAndroid"));
        assert!(banner.contains(UNKNOWN));
        assert!(banner.contains(&row("Framework", MAA_FRAMEWORK_VERSION)));
    }

    #[test]
    fn environment_info_parses_the_bridge_payload() {
        let json = r#"{
            "time": "2026-01-02 03:04:05.006",
            "device": "Google Pixel 9",
            "android": "16",
            "sdkInt": 36,
            "abi": "arm64-v8a",
            "versionName": "0.1.0",
            "versionCode": 1000,
            "buildType": "debug"
        }"#;

        let parsed = EnvironmentInfo::parse(json).expect("payload parses");

        assert_eq!(parsed.sdk_int, 36);
        assert_eq!(parsed.version_code, 1000);
        assert_eq!(parsed.abi, "arm64-v8a");
        assert_eq!(parsed.build_type, "debug");
    }

    #[test]
    fn environment_info_rejects_a_non_object() {
        assert!(EnvironmentInfo::parse("not json").is_none());
    }

    #[test]
    fn device_info_rows_name_both_versions() {
        let rows = device_info_rows();
        assert!(rows.contains(APP_VERSION));
        assert!(rows.contains(MAA_FRAMEWORK_VERSION));
        assert!(rows.ends_with('\n'));
    }

    fn env_sh_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/env.sh")
    }
}
