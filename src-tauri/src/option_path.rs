//! Wire contract for Agent-accessible Android PI file/directory selections.
use serde::Deserialize;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OptionPathKind {
    File,
    Directory,
}

impl OptionPathKind {
    pub fn bridge_method(self) -> &'static str {
        match self {
            Self::File => "pickOptionFile",
            Self::Directory => "pickOptionDirectory",
        }
    }
}

#[cfg(any(target_os = "android", test))]
pub fn parse_picker_result(raw: Option<&str>) -> Result<Option<String>, String> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct ResultBody {
        path: Option<String>,
        error: Option<String>,
    }
    let Some(raw) = raw else { return Ok(None) };
    let result: ResultBody =
        serde_json::from_str(raw).map_err(|_| "Invalid option path picker response".to_string())?;
    match (result.path, result.error) {
        (Some(path), None)
            if path.starts_with("/storage/")
                && !path.contains('\0')
                && !path.split('/').any(|part| part == "." || part == "..") =>
        {
            Ok(Some(path))
        }
        (None, Some(error)) => Err(format!("Option path selection failed: {error}")),
        _ => Err("Invalid option path picker response".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_select_the_expected_bridge() {
        for (raw, method) in [
            ("file", "pickOptionFile"),
            ("directory", "pickOptionDirectory"),
        ] {
            let kind: OptionPathKind = serde_json::from_value(serde_json::json!(raw)).unwrap();
            assert_eq!(kind.bridge_method(), method);
        }
        assert!(serde_json::from_str::<OptionPathKind>("\"text\"").is_err());
    }

    #[test]
    fn cancellation_and_native_paths() {
        assert_eq!(parse_picker_result(None).unwrap(), None);
        assert_eq!(
            parse_picker_result(Some(
                r#"{"path":"/storage/emulated/0/Download/a b/中文.txt"}"#
            ))
            .unwrap(),
            Some("/storage/emulated/0/Download/a b/中文.txt".into())
        );
    }

    #[test]
    fn failures_and_malformed_responses_are_not_cancellation() {
        for raw in [
            r#"{"error":"unsupportedDirectory"}"#,
            r#"{"error":"unavailable"}"#,
            r#"{"error":"tooLarge"}"#,
            r#"{"error":"readFailed"}"#,
            r#"{"error":"busy"}"#,
            r#"{"error":"timeout"}"#,
            r#"{"path":"content://provider/id"}"#,
            r#"{"path":"relative"}"#,
            r#"{"path":"/data/user/0/app/files/input"}"#,
            r#"{"path":"/storage/emulated/0/../private"}"#,
            r#"{"path":""}"#,
            r#"{}"#,
            "invalid",
            "null",
            r#"{"path":"/storage/a","error":"readFailed"}"#,
            r#"{"path":"/storage/a","extra":1}"#,
            r#"{"path":"/storage/a\u0000b"}"#,
        ] {
            assert!(parse_picker_result(Some(raw)).is_err(), "{raw}");
        }
    }
}
