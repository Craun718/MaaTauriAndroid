import { beforeEach, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  getReleaseNotes: vi.fn(),
  markReleaseNotesRead: vi.fn(),
}));

import { getReleaseNotes, markReleaseNotesRead } from "../lib/api";
import { type ReleaseNote, releaseNoteIdentity } from "../lib/releaseNotes";
import { useReleaseNotesStore } from "./releaseNotesStore";

const note: ReleaseNote = {
  project: "a",
  channel: "stable",
  version: "2",
  source: "github",
  content: "x",
  savedAtEpochMs: 1,
  read: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  useReleaseNotesStore.setState({
    notes: undefined,
    dismissed: new Set(),
    revision: 0,
    loading: false,
  });
});
it("dismisses in session even if marking read fails", async () => {
  vi.mocked(markReleaseNotesRead).mockRejectedValue(new Error("disk"));
  await useReleaseNotesStore.getState().dismiss(note);
  expect(
    useReleaseNotesStore.getState().dismissed.has(releaseNoteIdentity(note)),
  ).toBe(true);
  expect(markReleaseNotesRead).toHaveBeenCalledWith("2");
});
it("handles a failed load without retaining another project's notes", async () => {
  useReleaseNotesStore.setState({ notes: { current: note, pending: null } });
  vi.mocked(getReleaseNotes).mockRejectedValue(new Error("offline"));
  await useReleaseNotesStore.getState().load();
  expect(useReleaseNotesStore.getState().notes).toBeUndefined();
  expect(useReleaseNotesStore.getState().loading).toBe(false);
});
