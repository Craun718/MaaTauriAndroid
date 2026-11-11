import { type ReactElement, useEffect, useState } from "react";
import { useTranslation } from "../lib/i18n";
import { shouldPromptReleaseNote, splitReleaseNote } from "../lib/releaseNotes";
import { useReleaseNotesStore } from "../store/releaseNotesStore";
import { useUpdateStore } from "../store/updateStore";
import { RichDescription } from "./RichDescription";
import { Modal } from "./ui/Modal";

export function ReleaseNoteContent({
  content,
  version,
  showVersion = true,
}: {
  content: string;
  version?: string;
  showVersion?: boolean;
}): ReactElement {
  const note = splitReleaseNote(content);
  return (
    <div className="space-y-3">
      {((showVersion && (note.version || version)) || note.date) && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          {showVersion && (note.version || version) && (
            <span className="badge badge-neutral">
              {version ?? note.version}
            </span>
          )}
          {note.date && <span className="text-ink-muted">{note.date}</span>}
        </p>
      )}
      <RichDescription text={note.body} />
    </div>
  );
}

export function ReleaseNotesEntry(): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const notes = useReleaseNotesStore((state) => state.notes);
  const load = useReleaseNotesStore((state) => state.load);
  const channel = useUpdateStore((state) => state.prefs?.channel);
  useEffect(() => {
    void load(channel);
  }, [load, channel]);
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost w-full justify-between"
        onClick={() => {
          void load();
          setOpen(true);
        }}
      >
        {t("releaseNotesTitle")}
        <span aria-hidden="true">›</span>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("releaseNotesTitle")}
      >
        {!notes?.current && !notes?.pending && <p>{t("releaseNotesEmpty")}</p>}
        {notes?.current && (
          <section className="space-y-2">
            <h3 className="font-medium">{t("releaseNotesInstalled")}</h3>
            <ReleaseNoteContent
              content={notes.current.content}
              version={notes.current.version}
            />
          </section>
        )}
        {notes?.pending && (
          <section className="space-y-2">
            <h3 className="font-medium">{t("releaseNotesPending")}</h3>
            <ReleaseNoteContent
              content={notes.pending.content}
              version={notes.pending.version}
            />
          </section>
        )}
      </Modal>
    </>
  );
}

/** Hosted after the home-page announcement so startup modals never overlap. */
export function ReleaseNotesPrompt({
  project,
  blocked,
}: {
  project: string;
  blocked: boolean;
}): ReactElement | null {
  const { t } = useTranslation();
  const notes = useReleaseNotesStore((state) => state.notes);
  const dismissed = useReleaseNotesStore((state) => state.dismissed);
  const dismiss = useReleaseNotesStore((state) => state.dismiss);
  const load = useReleaseNotesStore((state) => state.load);
  useEffect(() => {
    void load(project);
  }, [load, project]);
  const note = notes?.current;
  if (
    !note ||
    note.project !== project ||
    !shouldPromptReleaseNote(note, blocked, dismissed)
  )
    return null;
  return (
    <Modal
      open
      onClose={() => {
        void dismiss(note);
      }}
      title={t("releaseNotesTitle")}
    >
      <ReleaseNoteContent content={note.content} version={note.version} />
    </Modal>
  );
}
