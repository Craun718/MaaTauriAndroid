import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RichDescription } from "./RichDescription";

const mocks = vi.hoisted(() => ({
  openUrl: vi.fn(),
  readProjectImage: vi.fn(),
  createObjectURL: vi.fn<(blob: Blob) => string>(() => "blob:project-image"),
  revokeObjectURL: vi.fn(),
}));

const { createObjectURL, openUrl, readProjectImage, revokeObjectURL } = mocks;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => mocks.openUrl(url),
}));

vi.mock("../lib/api", () => ({
  readProjectImage: (path: string) => mocks.readProjectImage(path),
}));

beforeEach(() => {
  openUrl.mockReset();
  readProjectImage.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});

afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

describe("RichDescription", () => {
  it("renders Markdown formatting, lists and links", () => {
    render(
      <RichDescription
        text={"**Bold** and [site](https://example.com)\n\n- one\n- two"}
      />,
    );

    expect(screen.getByText("Bold").tagName).toBe("STRONG");
    expect(screen.getByRole("link", { name: "site" })).toHaveAttribute(
      "href",
      "https://example.com",
    );
    expect(screen.getByText("one").closest("li")).toBeInTheDocument();
    expect(screen.getByText("two").closest("li")).toBeInTheDocument();
  });

  it("renders whitelisted inline HTML", () => {
    render(
      <RichDescription text={'<b>bold</b> <a href="https://example.com">link</a>'} />,
    );

    expect(screen.getByText("bold").tagName).toBe("B");
    expect(screen.getByRole("link", { name: "link" })).toHaveAttribute(
      "href",
      "https://example.com",
    );
  });

  it("strips scripts, styles, event handlers and unsafe URLs", () => {
    const { container } = render(
      <RichDescription
        text={
          '<script>alert(1)</script><style>p{color:red}</style>' +
          '<b onclick="alert(2)">ok</b><a href="javascript:alert(3)">bad</a>'
        }
      />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("style")).toBeNull();
    expect(screen.getByText("ok")).not.toHaveAttribute("onclick");
    expect(screen.getByText("bad").closest("a")).not.toHaveAttribute("href");
    expect(container.textContent).not.toContain("alert");
  });

  it("renders nothing for empty or whitespace-only text", () => {
    const blank = render(<RichDescription text="   " />);
    expect(blank.container).toBeEmptyDOMElement();

    const missing = render(<RichDescription />);
    expect(missing.container).toBeEmptyDOMElement();
  });

  it("opens links through the system browser instead of the WebView", async () => {
    render(<RichDescription text="[site](https://example.com)" />);

    expect(fireEvent.click(screen.getByRole("link", { name: "site" }))).toBe(false);
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://example.com"));
  });

  it("loads project-relative images through the backend", async () => {
    readProjectImage.mockResolvedValue(new ArrayBuffer(4));
    const { unmount } = render(
      <RichDescription text="![CCMain](resource/announcement/images/CCMain.png)" />,
    );

    const image = screen.getByAltText("CCMain");
    expect(readProjectImage).toHaveBeenCalledWith(
      "resource/announcement/images/CCMain.png",
    );

    await waitFor(() => expect(image).toHaveAttribute("src", "blob:project-image"));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe("image/png");

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:project-image");
  });
});
