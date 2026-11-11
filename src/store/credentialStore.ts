import { create } from "zustand";
import { getCredentialStatus, validateCredential } from "../lib/api";
import type { CredentialStatus } from "../lib/credentialStatus";

interface CredentialStore {
  status?: CredentialStatus;
  pending: boolean;
  revision: number;
  scope?: string;
  load: (scope: string) => Promise<void>;
  validate: () => Promise<void>;
}
export const useCredentialStore = create<CredentialStore>((set, get) => ({
  pending: false,
  revision: 0,
  async load(scope) {
    const revision = get().revision + 1;
    set({
      revision,
      scope,
      status: scope === get().scope ? get().status : undefined,
    });
    const status = await getCredentialStatus().catch(() => undefined);
    if (get().revision === revision) set({ status });
  },
  async validate() {
    if (get().pending) return;
    const revision = get().revision + 1;
    set({ pending: true, revision });
    try {
      const status = await validateCredential();
      if (get().revision === revision) set({ status });
    } catch {
      if (get().revision === revision)
        set({
          status: {
            state: "unknown",
            checking: false,
            expiresAtSeconds: null,
            failure: "network",
          },
        });
    } finally {
      set({ pending: false });
    }
  },
}));
