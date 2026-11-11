export interface ReleaseNote {
  project: string;
  channel: "stable" | "beta";
  version: string;
  source: string;
  content: string;
  savedAtEpochMs: number;
  read: boolean;
}

export interface ReleaseNotes {
  current: ReleaseNote | null;
  pending: ReleaseNote | null;
}

export function releaseNoteIdentity(note: ReleaseNote): string {
  return JSON.stringify([note.project, note.channel, note.version]);
}

export function shouldPromptReleaseNote(
  note: ReleaseNote | null | undefined,
  blocked: boolean,
  dismissed: ReadonlySet<string>,
): boolean {
  return Boolean(
    note && !note.read && !blocked && !dismissed.has(releaseNoteIdentity(note)),
  );
}

export function splitReleaseNote(content: string): {
  version?: string;
  date?: string;
  body: string;
} {
  const trimmed = content.trimStart();
  const match =
    /^##\s*\[([^\]]+)\]\([^\s)]+\)\s*-\s*(\d{4}-\d{2}-\d{2})\s*$/u.exec(
      trimmed.split("\n")[0],
    );
  return match
    ? {
        version: match[1],
        date: match[2],
        body: trimmed.includes("\n")
          ? trimmed.slice(trimmed.indexOf("\n") + 1).trimStart()
          : "",
      }
    : { body: content };
}
