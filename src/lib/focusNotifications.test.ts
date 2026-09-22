import { describe, expect, it } from "vitest";
import { focusNoticePresentation } from "./focusNotifications";

describe("focus notice presentation", () => {
  it("routes modal notices to the blocking host regardless of permissions", () => {
    expect(focusNoticePresentation("modal", true)).toBe("modal");
    expect(focusNoticePresentation("modal", false)).toBe("modal");
  });

  it("keeps dialog notices on the dismissible card", () => {
    expect(focusNoticePresentation("dialog", true)).toBe("card");
    expect(focusNoticePresentation("dialog", false)).toBe("card");
  });

  it("backs notification notices with the card only without permission", () => {
    expect(focusNoticePresentation("notification", true)).toBe("system");
    expect(focusNoticePresentation("notification", false)).toBe("card");
  });

  it("ignores channels the page never renders", () => {
    expect(focusNoticePresentation("log", true)).toBe("none");
    expect(focusNoticePresentation("toast", false)).toBe("none");
    expect(focusNoticePresentation("unknown", false)).toBe("none");
  });
});
