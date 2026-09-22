/// Where a `focus-notify` message should surface in the app, per the
/// ProjectInterface V2 `display` channel it arrived on.
export type FocusNoticePresentation = "card" | "modal" | "system" | "none";

/// Decides the in-app presentation of a focus message:
///
/// - `modal` renders in the global blocking host (`FocusModalHost`), never
///   as the page-level card, because the backend run queue waits on it.
/// - `notification` messages are posted to the OS notification center by
///   the backend; the in-app card only backs them up while the runtime
///   permission is missing.
/// - `dialog` keeps the dismissible page-level card and never blocks.
export function focusNoticePresentation(
  channel: string,
  notificationsAllowed: boolean,
): FocusNoticePresentation {
  switch (channel) {
    case "modal":
      return "modal";
    case "dialog":
      return "card";
    case "notification":
      return notificationsAllowed ? "system" : "card";
    default:
      return "none";
  }
}
