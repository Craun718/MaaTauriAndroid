import { useEffect, useState } from "react";
import type { ComponentPropsWithoutRef, MouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { readProjectImage } from "../lib/api";

const sanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
};

type MarkdownLinkProps = ComponentPropsWithoutRef<"a"> & { node?: unknown };
type MarkdownImageProps = ComponentPropsWithoutRef<"img"> & { node?: unknown };

function MarkdownLink({ node: _node, href, children, ...rest }: MarkdownLinkProps) {
  async function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    event.stopPropagation();
    const url = typeof href === "string" ? href : "";
    if (!/^(https?:|mailto:)/i.test(url)) return;
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <a {...rest} href={href} rel="noreferrer" onClick={handleClick}>
      {children}
    </a>
  );
}

function projectImagePath(source?: string): string | undefined {
  const value = source?.trim();
  if (!value || value.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(value)) return undefined;
  const path = value.split(/[?#]/, 1)[0];
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function imageMimeType(path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (extension) {
    case "avif":
      return "image/avif";
    case "bmp":
      return "image/bmp";
    case "gif":
      return "image/gif";
    case "ico":
      return "image/x-icon";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function MarkdownImage({ node: _node, src, ...rest }: MarkdownImageProps) {
  const projectPath = projectImagePath(src);
  const [assetSrc, setAssetSrc] = useState<string>();

  useEffect(() => {
    if (!projectPath) return;
    let active = true;
    let objectUrl: string | undefined;

    void readProjectImage(projectPath)
      .then((bytes) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: imageMimeType(projectPath) }));
        setAssetSrc(objectUrl);
      })
      .catch(() => undefined);

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectPath]);

  return (
    <img
      {...rest}
      src={assetSrc ?? src}
      data-state={projectPath && !assetSrc ? "loading" : undefined}
    />
  );
}

interface RichDescriptionProps {
  text?: string;
  className?: string;
}

/**
 * Interface `description` renderer: Markdown plus the subset of inline HTML the
 * project schema documents, sanitized before it ever reaches the WebView.
 */
export function RichDescription({ text, className }: RichDescriptionProps) {
  if (!text?.trim()) return null;
  return (
    <div className={className ? `rich-description ${className}` : "rich-description"}>
      <Markdown
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        components={{ a: MarkdownLink, img: MarkdownImage }}
      >
        {text}
      </Markdown>
    </div>
  );
}
