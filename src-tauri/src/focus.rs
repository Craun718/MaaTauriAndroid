use maa_framework::event_sink::EventSink;
use maa_framework::notification::{msg, MaaEvent};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// Channel the resource author asked a focus message to be shown on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Channel {
    Log,
    Toast,
    Notification,
    Dialog,
    Modal,
}

impl Channel {
    fn name(self) -> &'static str {
        match self {
            Channel::Log => "log",
            Channel::Toast => "toast",
            Channel::Notification => "notification",
            Channel::Dialog => "dialog",
            Channel::Modal => "modal",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusPayload {
    pub channel: String,
    pub message_type: String,
    pub name: Option<String>,
    pub message: String,
}

struct FocusTemplate {
    content: Option<String>,
    display: Vec<Channel>,
    trace: Option<bool>,
}

/// Handles MaaFramework node notifications carrying a `focus` template:
/// renders the message to the requested channels and lets telemetry decide
/// whether the node result is worth uploading.
pub struct FocusSink {
    app: AppHandle,
    translations: Arc<BTreeMap<String, String>>,
}

impl FocusSink {
    pub fn new(app: AppHandle, translations: BTreeMap<String, String>) -> Self {
        Self {
            app,
            translations: Arc::new(translations),
        }
    }

    fn handle(&self, event: &MaaEvent) {
        let Some((message, detail)) = extract(event) else {
            return;
        };
        let Some(focus) = detail.get("focus") else {
            return;
        };
        let Some(template) = parse_focus(focus, message) else {
            return;
        };

        let content = template
            .content
            .as_deref()
            .map(|raw| localize(&substitute(raw, &detail), &self.translations));
        let name = detail
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_string);

        if let Some(content) = &content {
            for channel in &template.display {
                match channel {
                    Channel::Log => self.log(message, name.as_deref(), content),
                    Channel::Toast => {
                        self.emit("focus-toast", message, name.as_deref(), content, "toast")
                    }
                    Channel::Notification | Channel::Dialog | Channel::Modal => self.emit(
                        "focus-notify",
                        message,
                        name.as_deref(),
                        content,
                        channel.name(),
                    ),
                }
            }
        }

        if crate::telemetry::enabled() && effective_trace(message, template.trace) {
            crate::telemetry::node_trace(message, content.as_deref(), name.as_deref());
        }
    }

    fn log(&self, message_type: &str, name: Option<&str>, content: &str) {
        let Some(logger) = crate::run_log::latest_global() else {
            return;
        };
        let data = serde_json::json!({
            "channel": "log",
            "messageType": message_type,
            "name": name,
        });
        if let Ok(event) = logger.append(
            crate::run_log::RunEventKind::Focus,
            crate::runtime::RunState::Running,
            content,
            name.map(str::to_string),
            Some(data),
        ) {
            let _ = self.app.emit("run-event", &event);
        }
    }

    fn emit(
        &self,
        event_name: &str,
        message_type: &str,
        name: Option<&str>,
        content: &str,
        channel: &str,
    ) {
        let payload = FocusPayload {
            channel: channel.to_string(),
            message_type: message_type.to_string(),
            name: name.map(str::to_string),
            message: content.to_string(),
        };
        let _ = self.app.emit(event_name, payload);
    }
}

impl EventSink for FocusSink {
    fn on_event(&self, _handle: maa_framework::common::MaaId, event: &MaaEvent) {
        self.handle(event);
    }
}

/// Pull out the (message type, detail) pair for every event that can carry a
/// `focus` template. Everything else is not a node notification and is ignored.
fn extract(event: &MaaEvent) -> Option<(&'static str, Value)> {
    fn serialize<T: serde::Serialize>(detail: &T) -> Option<Value> {
        serde_json::to_value(detail).ok()
    }
    match event {
        MaaEvent::NodePipelineNodeStarting(detail) => {
            Some((msg::NODE_PIPELINE_NODE_STARTING, serialize(detail)?))
        }
        MaaEvent::NodePipelineNodeSucceeded(detail) => {
            Some((msg::NODE_PIPELINE_NODE_SUCCEEDED, serialize(detail)?))
        }
        MaaEvent::NodePipelineNodeFailed(detail) => {
            Some((msg::NODE_PIPELINE_NODE_FAILED, serialize(detail)?))
        }
        MaaEvent::NodeRecognitionStarting(detail) => {
            Some((msg::NODE_RECOGNITION_STARTING, serialize(detail)?))
        }
        MaaEvent::NodeRecognitionSucceeded(detail) => {
            Some((msg::NODE_RECOGNITION_SUCCEEDED, serialize(detail)?))
        }
        MaaEvent::NodeRecognitionFailed(detail) => {
            Some((msg::NODE_RECOGNITION_FAILED, serialize(detail)?))
        }
        MaaEvent::NodeActionStarting(detail) => {
            Some((msg::NODE_ACTION_STARTING, serialize(detail)?))
        }
        MaaEvent::NodeActionSucceeded(detail) => {
            Some((msg::NODE_ACTION_SUCCEEDED, serialize(detail)?))
        }
        MaaEvent::NodeActionFailed(detail) => Some((msg::NODE_ACTION_FAILED, serialize(detail)?)),
        _ => None,
    }
}

fn parse_focus(focus: &Value, message: &str) -> Option<FocusTemplate> {
    let entry = focus.get(message)?;
    match entry {
        Value::String(content) => Some(FocusTemplate {
            content: Some(content.clone()),
            display: vec![Channel::Log],
            trace: None,
        }),
        Value::Object(object) => {
            let content = object
                .get("content")
                .and_then(Value::as_str)
                .map(str::to_string);
            let trace = object.get("trace").and_then(Value::as_bool);
            if content.is_none() && trace.is_none() {
                return None;
            }
            Some(FocusTemplate {
                content,
                display: parse_display(object.get("display")),
                trace,
            })
        }
        _ => None,
    }
}

fn parse_display(value: Option<&Value>) -> Vec<Channel> {
    let mut channels = Vec::new();
    let mut push = |value: &str| {
        let channel = match value.trim().to_ascii_lowercase().as_str() {
            "toast" => Channel::Toast,
            "notification" => Channel::Notification,
            "dialog" => Channel::Dialog,
            "modal" => Channel::Modal,
            _ => Channel::Log,
        };
        if !channels.contains(&channel) {
            channels.push(channel);
        }
    };
    match value {
        Some(Value::String(value)) => push(value),
        Some(Value::Array(values)) => {
            for value in values {
                if let Value::String(value) = value {
                    push(value);
                }
            }
        }
        _ => channels.push(Channel::Log),
    }
    if channels.is_empty() {
        channels.push(Channel::Log);
    }
    channels
}

fn substitute(template: &str, detail: &Value) -> String {
    let Some(object) = detail.as_object() else {
        return template.to_string();
    };
    let mut output = template.to_string();
    for (key, value) in object {
        let text = match value {
            Value::String(value) => value.clone(),
            Value::Number(value) => value.to_string(),
            Value::Bool(value) => value.to_string(),
            _ => continue,
        };
        let placeholder = format!("{{{key}}}");
        if output.contains(&placeholder) {
            output = output.replace(&placeholder, &text);
        }
    }
    output
}

fn localize(content: &str, translations: &BTreeMap<String, String>) -> String {
    let Some(key) = content.strip_prefix('$') else {
        return content.to_string();
    };
    translations
        .get(key)
        .cloned()
        .unwrap_or_else(|| content.to_string())
}

/// A focus template controls uploading to telemetry when `trace` is not written
/// out: node failures upload by default, everything else stays local-only.
fn effective_trace(message: &str, explicit: Option<bool>) -> bool {
    explicit.unwrap_or_else(|| message == msg::NODE_PIPELINE_NODE_FAILED)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn string_template_defaults_to_log_route() {
        let focus = serde_json::json!({ "Node.Action.Starting": "{name} 开始执行" });
        let template = parse_focus(&focus, "Node.Action.Starting").unwrap();
        assert_eq!(template.content.as_deref(), Some("{name} 开始执行"));
        assert_eq!(template.display, vec![Channel::Log]);
        assert_eq!(template.trace, None);
    }

    #[test]
    fn object_template_reads_content_display_and_trace() {
        let focus = serde_json::json!({
            "Node.Action.Failed": {
                "content": "❌ {name} 执行失败",
                "display": ["log", "toast"],
                "trace": true
            }
        });
        let template = parse_focus(&focus, "Node.Action.Failed").unwrap();
        assert_eq!(template.display, vec![Channel::Log, Channel::Toast]);
        assert_eq!(template.trace, Some(true));
    }

    #[test]
    fn trace_only_object_stays_ui_silent() {
        let focus = serde_json::json!({ "Node.PipelineNode.Succeeded": { "trace": true } });
        let template = parse_focus(&focus, "Node.PipelineNode.Succeeded").unwrap();
        assert!(template.content.is_none());
        assert_eq!(template.trace, Some(true));
    }

    #[test]
    fn missing_template_is_ignored() {
        let focus = serde_json::json!({ "Node.Action.Failed": "x" });
        assert!(parse_focus(&focus, "Node.Action.Starting").is_none());
    }

    #[test]
    fn substitutes_detail_fields_into_the_template() {
        let detail = serde_json::json!({ "name": "NodeA", "task_id": 12345 });
        assert_eq!(
            substitute("{name} 任务 {task_id}", &detail),
            "NodeA 任务 12345"
        );
    }

    #[test]
    fn strips_localized_keys_through_the_translations() {
        let translations =
            BTreeMap::from([("关键一步".to_string(), "关键一步（中文）".to_string())]);
        assert_eq!(localize("$关键一步", &translations), "关键一步（中文）");
        assert_eq!(localize("$未知键", &translations), "$未知键");
        assert_eq!(localize("普通文本", &translations), "普通文本");
    }

    #[test]
    fn default_trace_on_pipeline_failures() {
        assert!(effective_trace("Node.PipelineNode.Failed", None));
        assert!(!effective_trace("Node.Action.Starting", None));
        assert!(!effective_trace("Node.PipelineNode.Succeeded", None));
        assert!(effective_trace("Node.Action.Starting", Some(true)));
        assert!(!effective_trace("Node.PipelineNode.Failed", Some(false)));
    }
}
