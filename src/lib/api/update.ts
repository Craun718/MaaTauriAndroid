import { invoke } from "@tauri-apps/api/core";
import type { UpdatePrefs, UpdateStatus } from "../types";

export async function getUpdateStatus() {
  return invoke<UpdateStatus>("update_get_status");
}

export async function checkForUpdate() {
  return invoke<UpdateStatus>("update_check");
}

export async function resolveUpdate() {
  return invoke<UpdateStatus>("update_resolve");
}

export async function cancelUpdate() {
  return invoke<UpdateStatus>("update_cancel");
}

export async function installUpdate() {
  return invoke<UpdateStatus>("update_install");
}

export async function getUpdatePrefs() {
  return invoke<UpdatePrefs>("update_get_prefs");
}

export async function setUpdatePrefs(prefs: UpdatePrefs) {
  return invoke<UpdatePrefs>("update_set_prefs", { prefs });
}

export async function getReleaseNotes(): Promise<
  import("../releaseNotes").ReleaseNotes
> {
  return invoke("update_get_release_notes");
}

export async function markReleaseNotesRead(version: string): Promise<void> {
  return invoke("update_mark_release_notes_read", { version });
}

export async function getCredentialStatus(): Promise<
  import("../credentialStatus").CredentialStatus
> {
  return invoke("update_get_credential_status");
}

export async function validateCredential(): Promise<
  import("../credentialStatus").CredentialStatus
> {
  return invoke("update_validate_credential");
}

export async function validateGithubToken(): Promise<boolean> {
  return invoke("update_validate_github_token");
}
