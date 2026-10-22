export interface DirectoryAccessDiagnostic {
  scope: "agentRuntime" | "maaLogs";
  kind: "permission" | "readOnly" | "noSpace" | "notDirectory" | "unknown";
  operation: string;
  path: string;
}

export function parseDirectoryAccess(
  value: unknown,
): DirectoryAccessDiagnostic | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const fields = value as Record<string, unknown>;
  if (
    (fields.scope !== "agentRuntime" && fields.scope !== "maaLogs") ||
    typeof fields.operation !== "string" ||
    typeof fields.path !== "string" ||
    typeof fields.kind !== "string" ||
    !["permission", "readOnly", "noSpace", "notDirectory", "unknown"].includes(
      fields.kind,
    )
  )
    return undefined;
  return {
    scope: fields.scope,
    operation: fields.operation,
    path: fields.path,
    kind: fields.kind as DirectoryAccessDiagnostic["kind"],
  };
}

/** Binder and Rust may prefix or suffix the diagnostic with their own errors. */
export function extractDirectoryAccess(
  message: string,
): DirectoryAccessDiagnostic | undefined {
  const marker = "MTA_DIRECTORY_ACCESS=";
  const start = message.indexOf(marker);
  if (start < 0) return undefined;
  const json = message.slice(
    start + marker.length,
    start + marker.length + 16384,
  );
  if (json[0] !== "{") return undefined;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < json.length; index++) {
    const char = json[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      try {
        return parseDirectoryAccess(JSON.parse(json.slice(0, index + 1)));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
