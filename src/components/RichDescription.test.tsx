import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RichDescription } from "./RichDescription";

const openUrl = vi.fn();

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => openUrl(url),
}));

beforeEach(() => {
  openUrl.mockReset();
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
});
