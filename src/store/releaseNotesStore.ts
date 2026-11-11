import { create } from "zustand";
import { getReleaseNotes, markReleaseNotesRead } from "../lib/api";
import {
  type ReleaseNote,
  type ReleaseNotes,
  releaseNoteIdentity,
} from "../lib/releaseNotes";

interface ReleaseNotesStore {
  notes?: ReleaseNotes;
  dismissed: ReadonlySet<string>;
  loading: boolean;
  scope?: string;
  revision: number;
  load: (scope?: string) => Promise<void>;
  dismiss: (note: ReleaseNote) => Promise<void>;
}

export const useReleaseNotesStore = create<ReleaseNotesStore>((set, get) => ({
  notes: undefined,
  dismissed: new Set(),
  loading: false,
  revision: 0,
  async load(scope) {
    const revision = get().revision + 1;
    set({ revision, scope, loading: true, notes: undefined });
    const notes = await getReleaseNotes().catch(() => undefined);
    if (get().revision === revision) set({ notes, loading: false });
  },
  async dismiss(note) {
    set({
      dismissed: new Set([...get().dismissed, releaseNoteIdentity(note)]),
    });
    // A failed write retries next launch, never by reopening this session's modal.
    await markReleaseNotesRead(note.version).catch(() => undefined);
  },
}));
