import { describe, expect, it } from "vitest";
import { hasInlineRichText, stripInlineRichText } from "./richText";

describe("inline rich text", () => {
  it("detects supported Markdown and HTML syntax", () => {
    expect(hasInlineRichText("![icon](resource/icon.png) daily")).toBe(true);
    expect(hasInlineRichText("[site](https://example.com)")).toBe(true);
    expect(hasInlineRichText("`code`")).toBe(true);
    expect(hasInlineRichText("**important**")).toBe(true);
    expect(hasInlineRichText('<span data-x="1">styled</span>')).toBe(true);
    expect(hasInlineRichText('<font color="red">colored</font>')).toBe(true);
  });

  it("keeps ordinary punctuation as plain text", () => {
    expect(hasInlineRichText("Emulator <MuMu> startup")).toBe(false);
    expect(hasInlineRichText("snake_case_label")).toBe(false);
    expect(hasInlineRichText("5 * 3 = 15")).toBe(false);
  });

  it("strips supported syntax for native text surfaces", () => {
    expect(stripInlineRichText("![star](icon.png) **daily** `task`")).toBe(
      "star daily task",
    );
    expect(
      stripInlineRichText(
        '<span style="x">event</span> [docs](https://example.com)',
      ),
    ).toBe("event docs");
    expect(stripInlineRichText("Emulator <MuMu> startup")).toBe(
      "Emulator <MuMu> startup",
    );
  });
});
