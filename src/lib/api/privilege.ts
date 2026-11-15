import { invoke } from "@tauri-apps/api/core";
import type { PrivilegedBackend, PrivilegedStatus } from "../types";

export async function getPrivilegedStatus() {
  return invoke<PrivilegedStatus>("privileged_status");
}

export async function getPrivilegedBackend() {
  return invoke<PrivilegedBackend>("get_privileged_backend");
}

export async function setPrivilegedBackend(backend: PrivilegedBackend) {
  return invoke<void>("set_privileged_backend", { backend });
}

export async function requestPrivilegedAccess() {
  return invoke<void>("request_privileged_access");
}

export async function openShizuku() {
  return invoke<void>("open_shizuku");
}
