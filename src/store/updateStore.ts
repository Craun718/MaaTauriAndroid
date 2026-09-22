import { create } from "zustand";
import {
  cancelUpdate,
  checkForUpdate,
  getUpdatePrefs,
  getUpdateStatus,
  installUpdate,
  setUpdatePrefs as invokeSetUpdatePrefs,
  resolveUpdate,
} from "../lib/api";
import type { UpdatePhase, UpdatePrefs, UpdateStatus } from "../lib/types";

/** Phases with a backend task in flight; the card polls while one runs. */
export function isActiveUpdatePhase(phase: UpdatePhase): boolean {
  return (
    phase === "checking" || phase === "resolving" || phase === "downloading"
  );
}

interface UpdateStore {
  status?: UpdateStatus;
  prefs?: UpdatePrefs;
  /** True while a prefs save is in flight; edits stay disabled meanwhile. */
  prefsBusy: boolean;
  load: () => Promise<void>;
  poll: () => Promise<void>;
  check: () => Promise<void>;
  resolve: () => Promise<void>;
  cancel: () => Promise<void>;
  install: () => Promise<void>;
  setPrefs: (next: UpdatePrefs) => Promise<void>;
}

function setStatus(status: UpdateStatus) {
  useUpdateStore.setState({ status });
}

/**
 * The check and resolve commands return right after spawning their backend
 * task, so the card switches immediately and lets the poll observe the
 * outcome. A stale active-phase echo from the action response at worst costs
 * one poll tick; every response is the backend's current snapshot and wins.
 */
function optimisticPhase(
  phase: Extract<UpdatePhase, "checking" | "resolving">,
) {
  const previous = useUpdateStore.getState().status;
  if (!previous) return;
  setStatus({
    ...previous,
    phase,
    failure: null,
    failureDetail: null,
  });
}

export const useUpdateStore = create<UpdateStore>((set) => ({
  status: undefined,
  prefs: undefined,
  prefsBusy: false,
  async load() {
    set({
      status: await getUpdateStatus().catch(() => undefined),
      prefs: await getUpdatePrefs().catch(() => undefined),
    });
  },
  async poll() {
    const status = await getUpdateStatus().catch(() => undefined);
    if (status) setStatus(status);
  },
  async check() {
    optimisticPhase("checking");
    const status = await checkForUpdate().catch(() => undefined);
    if (status) setStatus(status);
  },
  async resolve() {
    optimisticPhase("resolving");
    const status = await resolveUpdate().catch(() => undefined);
    if (status) setStatus(status);
  },
  async cancel() {
    const status = await cancelUpdate().catch(() => undefined);
    if (status) setStatus(status);
  },
  async install() {
    const status = await installUpdate().catch(() => undefined);
    if (status) setStatus(status);
  },
  async setPrefs(next) {
    set({ prefs: next, prefsBusy: true });
    // The backend echoes the saved prefs back, and keeps the old values when a
    // task is in flight; either way the response is authoritative.
    const saved = await invokeSetUpdatePrefs(next).catch(() => undefined);
    set({ prefs: saved ?? next, prefsBusy: false });
  },
}));
