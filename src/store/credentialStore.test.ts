import { beforeEach, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  getCredentialStatus: vi.fn(),
  validateCredential: vi.fn(),
}));

import { getCredentialStatus, validateCredential } from "../lib/api";
import { useCredentialStore } from "./credentialStore";

beforeEach(() => {
  vi.clearAllMocks();
  useCredentialStore.setState({
    status: undefined,
    pending: false,
    revision: 0,
    scope: undefined,
  });
});
it("validates only the saved backend credential and handles transport failure", async () => {
  vi.mocked(validateCredential).mockRejectedValue(new Error("offline"));
  await useCredentialStore.getState().validate();
  expect(validateCredential).toHaveBeenCalledWith();
  expect(useCredentialStore.getState().status?.failure).toBe("network");
  expect(useCredentialStore.getState().pending).toBe(false);
});
it("clears previous credential status on scope change", async () => {
  vi.mocked(getCredentialStatus).mockRejectedValue(new Error("offline"));
  await useCredentialStore.getState().load("new-code");
  expect(useCredentialStore.getState().status).toBeUndefined();
});
