import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBackgroundImage } from "./api";
import {
  backgroundImageMimeType,
  loadBackgroundImageObjectUrl,
} from "./backgroundImage";

const createObjectUrl = vi.fn();
const revokeObjectUrl = vi.fn();
const mockedReadBackgroundImage = vi.mocked(readBackgroundImage);
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

vi.mock("./api", () => ({
  readBackgroundImage: vi.fn(),
}));

describe("background image helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = createObjectUrl;
    URL.revokeObjectURL = revokeObjectUrl;
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  });

  it("maps generated file names to image MIME types", () => {
    expect(backgroundImageMimeType("background.avif")).toBe("image/avif");
    expect(backgroundImageMimeType("background.bmp")).toBe("image/bmp");
    expect(backgroundImageMimeType("background.gif")).toBe("image/gif");
    expect(backgroundImageMimeType("background.ico")).toBe("image/x-icon");
    expect(backgroundImageMimeType("background.jpg")).toBe("image/jpeg");
    expect(backgroundImageMimeType("background.jpeg")).toBe("image/jpeg");
    expect(backgroundImageMimeType("background.png")).toBe("image/png");
    expect(backgroundImageMimeType("background.webp")).toBe("image/webp");
    expect(backgroundImageMimeType("background.svg")).toBe(
      "application/octet-stream",
    );
  });

  it("creates a typed object URL for image bytes", async () => {
    const bytes = new TextEncoder().encode("image bytes").buffer;
    createObjectUrl.mockReturnValue("blob:background");
    mockedReadBackgroundImage.mockResolvedValue(bytes);

    await expect(
      loadBackgroundImageObjectUrl({
        fileName: "background.png",
        revision: 3,
      }),
    ).resolves.toBe("blob:background");

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    const blob = createObjectUrl.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(bytes.byteLength);
  });

  it("falls back to no URL when the image cannot be read", async () => {
    mockedReadBackgroundImage.mockRejectedValue(new Error("image missing"));

    await expect(
      loadBackgroundImageObjectUrl({
        fileName: "background.png",
        revision: 3,
      }),
    ).resolves.toBeUndefined();

    expect(createObjectUrl).not.toHaveBeenCalled();
  });
});
