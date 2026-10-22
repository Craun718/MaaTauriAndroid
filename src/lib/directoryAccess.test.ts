import { describe, expect, it } from "vitest";
import {
  extractDirectoryAccess,
  parseDirectoryAccess,
} from "./directoryAccess";

describe("directory access diagnostic protocol", () => {
  const diagnostic = {
    scope: "agentRuntime",
    kind: "permission",
    path: '/runtime/"{a}',
    operation: "probe",
  };
  it("preserves structured values through wrapped Binder/JNI errors", () => {
    const message = `Maa error: IllegalStateException: MTA_DIRECTORY_ACCESS=${JSON.stringify({ ...diagnostic, parent: { uid: 0 } })} trailing`;
    expect(extractDirectoryAccess(message)).toEqual(diagnostic);
    expect(
      parseDirectoryAccess({
        ...diagnostic,
        kind: "readOnly",
        scope: "maaLogs",
      }),
    ).toEqual({ ...diagnostic, kind: "readOnly", scope: "maaLogs" });
  });
  it("does not turn malformed payloads or unrelated failures into storage errors", () => {
    for (const value of [
      null,
      [],
      {},
      { ...diagnostic, scope: "other" },
      { ...diagnostic, kind: "other" },
      { ...diagnostic, path: 3 },
    ]) {
      expect(parseDirectoryAccess(value)).toBeUndefined();
    }
    for (const value of [
      "unrelated",
      "MTA_DIRECTORY_ACCESS={bad}",
      "MTA_DIRECTORY_ACCESS={",
      `MTA_DIRECTORY_ACCESS=${JSON.stringify(diagnostic).slice(0, -1)}`,
      'MTA_DIRECTORY_ACCESS={"path":"' + "a".repeat(17000),
    ]) {
      expect(extractDirectoryAccess(value)).toBeUndefined();
    }
  });
});
