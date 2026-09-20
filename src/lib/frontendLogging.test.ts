import { error, warn } from "@tauri-apps/plugin-log";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatLogValue,
  installFrontendErrorLogging,
  reportFrontendError,
  reportFrontendWarning,
} from "./frontendLogging";

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(() => Promise.resolve()),
  warn: vi.fn(() => Promise.resolve()),
}));

const errorMock = vi.mocked(error);
const warnMock = vi.mocked(warn);

describe("frontend logging", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  let consoleWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorMock.mockClear();
    warnMock.mockClear();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });

  it("formats errors and non-error values", () => {
    expect(formatLogValue(new DOMException("stale", "InvalidStateError"))).toBe(
      "InvalidStateError: stale (code 11)",
    );
    const error = new TypeError("invalid");
    error.stack = "";
    expect(formatLogValue(error)).toBe("TypeError: invalid");
    expect(formatLogValue("failed")).toBe("failed");
    expect(formatLogValue({ id: 7 })).toBe('{"id":7}');
    expect(formatLogValue(undefined)).toBe("undefined");
  });

  it("reports errors to the console and Tauri log", () => {
    const error = new Error("offline");
    error.stack = "";
    reportFrontendError("Virtual display failed", error, {
      displayId: 2,
    });

    expect(errorMock).toHaveBeenCalledWith(
      'Virtual display failed\nError: offline\n{"displayId":2}',
    );
    expect(consoleError).toHaveBeenCalledWith(
      "Virtual display failed",
      expect.any(Error),
      { displayId: 2 },
    );
  });

  it("reports warnings to the console and Tauri log", () => {
    reportFrontendWarning("Socket closed", { code: 1006 });

    expect(warnMock).toHaveBeenCalledWith('Socket closed\n{"code":1006}');
    expect(consoleWarn).toHaveBeenCalledWith("Socket closed", { code: 1006 });
  });

  it("logs uncaught errors and removes the listeners on cleanup", async () => {
    const removeListeners = installFrontendErrorLogging();

    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "script crashed",
        filename: "main.js",
        lineno: 12,
        colno: 3,
      }),
    );

    await vi.waitFor(() => {
      expect(errorMock).toHaveBeenCalledWith(
        "Unhandled frontend error: script crashed",
        {
          file: "main.js",
          keyValues: { column: "3" },
          line: 12,
        },
      );
    });

    errorMock.mockClear();
    removeListeners();
    window.dispatchEvent(new ErrorEvent("error", { message: "again" }));

    expect(errorMock).not.toHaveBeenCalled();
  });

  it("logs unhandled promise rejections", async () => {
    const removeListeners = installFrontendErrorLogging();
    const reason = new Error("request failed");
    reason.stack = "";
    const rejectionEvent = new Event("unhandledrejection");
    Object.defineProperty(rejectionEvent, "reason", { value: reason });

    window.dispatchEvent(rejectionEvent as PromiseRejectionEvent);

    await vi.waitFor(() => {
      expect(errorMock).toHaveBeenCalledWith(
        "Unhandled promise rejection: Error: request failed",
      );
    });

    removeListeners();
  });
});
