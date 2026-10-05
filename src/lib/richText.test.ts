import { describe, expect, it } from "vitest";
import {
  hasInlineRichText,
  sanitizeInlineStyle,
  stripInlineRichText,
} from "./richText";

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

describe("inline style sanitizer", () => {
  it("keeps the safe layout properties used by announcements", () => {
    expect(
      sanitizeInlineStyle(
        "position: relative; width: 100%; display: flex; gap: 0.6rem; background: linear-gradient(#e8231f, #b80d14); transform: translate(-50%, -50%);",
      ),
    ).toBe(
      "position: relative; width: 100%; display: flex; gap: 0.6rem; background: linear-gradient(#e8231f, #b80d14); transform: translate(-50%, -50%)",
    );
  });

  it("drops unsupported properties and unsafe values separately", () => {
    expect(
      sanitizeInlineStyle(
        "position: fixed; z-index: 999; background: url(https://example.test/x.png); color: red;",
      ),
    ).toBe("color: red");
  });

  it("rejects CSS escapes, script-like values, and comments", () => {
    expect(sanitizeInlineStyle("color: red\\; behavior: url(#x)")).toBe("");
    expect(sanitizeInlineStyle("color: expression(alert(1))")).toBe("");
    expect(sanitizeInlineStyle("color: red /* hidden */")).toBe("");
  });
});
