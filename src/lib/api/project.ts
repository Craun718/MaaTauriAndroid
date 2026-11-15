import { invoke } from "@tauri-apps/api/core";

export async function pickOptionPath(
  kind: "file" | "directory",
): Promise<string | null> {
  return invoke<string | null>("pick_option_path", { kind });
}
