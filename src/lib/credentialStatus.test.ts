import { describe, expect, it } from "vitest";
import {
  type CredentialStatus,
  credentialPresentation,
} from "./credentialStatus";

const valid: CredentialStatus = {
  state: "valid",
  checking: false,
  expiresAtSeconds: null,
  failure: null,
};
describe("credential presentation", () => {
  it("uses seconds and warns within seven days", () => {
    expect(
      credentialPresentation(
        { ...valid, expiresAtSeconds: 100 + 7 * 86400 },
        100,
      ),
    ).toEqual({ key: "credentialExpiresIn", days: 7, warning: true });
    expect(
      credentialPresentation({ ...valid, expiresAtSeconds: 101 }, 100).days,
    ).toBe(1);
    expect(
      credentialPresentation({ ...valid, expiresAtSeconds: 100 }, 100).key,
    ).toBe("updateFailureCdkExpired");
  });
  it("does not call cached data freshly verified", () => {
    expect(
      credentialPresentation(
        { ...valid, state: "unknown", expiresAtSeconds: 1000 },
        1,
      ).key,
    ).toBe("credentialKnownExpiry");
    expect(credentialPresentation(valid, 1).key).toBe(
      "credentialValidUnknownExpiry",
    );
    expect(credentialPresentation({ ...valid, checking: true }, 1).key).toBe(
      "credentialChecking",
    );
    expect(
      credentialPresentation(
        { ...valid, state: "invalid", failure: "cdkInvalid" },
        1,
      ).key,
    ).toBe("updateFailureCdkInvalid");
  });
});
