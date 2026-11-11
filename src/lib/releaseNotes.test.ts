import { describe, expect, it } from "vitest";
import {
  type ReleaseNote,
  releaseNoteIdentity,
  shouldPromptReleaseNote,
  splitReleaseNote,
} from "./releaseNotes";

const note: ReleaseNote = {
  project: "a",
  channel: "stable",
  version: "2",
  source: "github",
  content: "changes",
  savedAtEpochMs: 1,
  read: false,
};
describe("release notes", () => {
  it("defers behind startup overlays and suppresses dismissed versions", () => {
    expect(shouldPromptReleaseNote(note, true, new Set())).toBe(false);
    expect(shouldPromptReleaseNote(note, false, new Set())).toBe(true);
    expect(
      shouldPromptReleaseNote({ ...note, read: true }, false, new Set()),
    ).toBe(false);
    expect(
      shouldPromptReleaseNote(
        note,
        false,
        new Set([releaseNoteIdentity(note)]),
      ),
    ).toBe(false);
    expect(shouldPromptReleaseNote(null, false, new Set())).toBe(false);
  });
  it("separates the generated header and preserves ordinary markdown", () => {
    expect(
      splitReleaseNote("## [2](https://example.com) - 2026-11-10\n\nChanges"),
    ).toEqual({ version: "2", date: "2026-11-10", body: "Changes" });
    expect(splitReleaseNote("# Changes").body).toBe("# Changes");
    expect(
      splitReleaseNote("## [2](https://example.com) - 2026-11-10").body,
    ).toBe("");
  });
});
