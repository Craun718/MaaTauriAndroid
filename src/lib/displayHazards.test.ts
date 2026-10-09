import { describe, expect, it } from "vitest";
import { pendingDisplayHazards } from "./displayHazards";

describe("pendingDisplayHazards", () => {
  it("prompts for smart resolution before eye protection in background mode", () => {
    expect(
      pendingDisplayHazards(
        {
          smartResolution: true,
          eyeProtectionSource: "xiaomi:screen_paper_mode_enabled",
        },
        false,
      ),
    ).toEqual(["smartResolution", "eyeProtection"]);
  });

  it("skips smart resolution in foreground mode", () => {
    expect(
      pendingDisplayHazards(
        {
          smartResolution: true,
          eyeProtectionSource: "aosp:night_display_activated",
        },
        true,
      ),
    ).toEqual(["eyeProtection"]);
  });

  it("returns no prompts when both checks are clear", () => {
    expect(
      pendingDisplayHazards(
        { smartResolution: false, eyeProtectionSource: null },
        false,
      ),
    ).toEqual([]);
  });
});
