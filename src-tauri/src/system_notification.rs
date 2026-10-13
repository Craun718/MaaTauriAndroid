//! The OS notification center surface.
//!
//! Focus messages repeat: the same node can fire the same sentence twice in one
//! run, and the plugin hands every post its own random id, so the second copy
//! lands next to the first instead of replacing it. Both callers post through
//! [`post`], which keys the notification on its content: the same content maps
//! to the same id, so it can never be shown twice.

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// Content ids live in `[0x4000_0000, 0x7FFF_FFFF]`, clear of the ids the
/// Kotlin side owns: the run foreground service, the schedule service and the
/// Shizuku warning post with the fixed ids 1-3, and the plugin's own default
/// is a random `i32` that can be negative.
const CONTENT_ID_BASE: i32 = 0x4000_0000;

/// Stable id for one notification: identical content must map to an identical
/// id, different content to a different one. FNV-1a rather than
/// `DefaultHasher`, whose output is allowed to change between toolchain
/// releases — a copy posted before an app update is only replaced while the id
/// still matches.
fn content_id(title: &str, body: &str) -> i32 {
    let mut hash: u32 = 0x811c_9dc5;
    for byte in title
        .as_bytes()
        .iter()
        .chain(b"\x1f")
        .chain(body.as_bytes())
    {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    CONTENT_ID_BASE | (hash & 0x3FFF_FFFF) as i32
}

/// Posts `title` / `body` to the OS notification center, dropping a still-shown
/// notification with the same content first. Best-effort: Android silently
/// drops the post while POST_NOTIFICATIONS is missing, and the frontend shows
/// its in-app fallback card in that case.
pub fn post(app: &AppHandle, title: &str, body: &str) {
    let id = content_id(title, body);
    let notification = app.notification();
    #[cfg(target_os = "android")]
    {
        // The plugin builds every notification with `setOnlyAlertOnce(true)`,
        // so re-posting onto an old copy would update it in place and stay
        // silent; cancelling first lets the repeat alert like a fresh one.
        if let Err(error) = notification.remove_active(vec![id]) {
            log::warn!("could not drop the previous notification: {error}");
        }
    }
    if let Err(error) = notification.builder().id(id).title(title).body(body).show() {
        log::warn!("system notification failed: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_content_maps_to_the_same_id() {
        assert_eq!(
            content_id("节点", "任务完成"),
            content_id("节点", "任务完成")
        );
    }

    #[test]
    fn different_content_maps_to_different_ids() {
        let base = content_id("节点", "任务完成");
        assert_ne!(base, content_id("节点", "任务失败"));
        assert_ne!(base, content_id("另一个节点", "任务完成"));
    }

    #[test]
    fn content_ids_stay_clear_of_the_kotlin_owned_ids() {
        for title in ["", "a", "节点名", "Scheduled run did not start"] {
            for body in ["", "b", "任务失败", "There are no enabled tasks to run"] {
                let id = content_id(title, body);
                assert!(id >= CONTENT_ID_BASE, "{id} escaped the reserved range");
            }
        }
    }
}
