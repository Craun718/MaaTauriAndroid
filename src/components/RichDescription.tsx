import { openUrl } from "@tauri-apps/plugin-opener";
import type { ComponentPropsWithoutRef, MouseEvent } from "react";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { readProjectImage } from "../lib/api";
import {
  hasInlineRichText,
  inlineHtmlTagNames,
  rehypeSanitizeInlineStyles,
} from "../lib/richText";

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "font"],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "style"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
};

const inlineMarkdownElements = ["del", ...inlineHtmlTagNames];

type MarkdownLinkProps = ComponentPropsWithoutRef<"a"> & { node?: unknown };
type MarkdownImageProps = ComponentPropsWithoutRef<"img"> & { node?: unknown };

function MarkdownLink({
  node: _node,
  href,
  children,
  ...rest
}: MarkdownLinkProps) {
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
  if (!value || value.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(value))
    return undefined;
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

function MarkdownImage({ node: _node, src, alt, ...rest }: MarkdownImageProps) {
  const projectPath = projectImagePath(src);
  const [assetSrc, setAssetSrc] = useState<string>();

  useEffect(() => {
    if (!projectPath) return;
    let active = true;
    let objectUrl: string | undefined;

    void readProjectImage(projectPath)
      .then((bytes) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(
          new Blob([bytes], { type: imageMimeType(projectPath) }),
        );
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
      alt={alt ?? ""}
      data-state={projectPath && !assetSrc ? "loading" : undefined}
    />
  );
}

interface RichDescriptionProps {
  text?: string;
  className?: string;
}

/**
 * Interface `description` renderer: GFM Markdown (tables and strikethrough —
 * contact files like M9A's are tables) plus the subset of inline HTML the
 * project schema documents, sanitized before it ever reaches the WebView.
 */
export function RichDescription({ text, className }: RichDescriptionProps) {
  if (!text?.trim()) return null;
  return (
    <div
      className={
        className ? `rich-description ${className}` : "rich-description"
      }
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeRaw,
          rehypeSanitizeInlineStyles,
          [rehypeSanitize, sanitizeSchema],
        ]}
        components={{ a: MarkdownLink, img: MarkdownImage }}
      >
        {text}
      </Markdown>
    </div>
  );
}

interface InlineMarkdownLabelProps {
  text: string;
  className?: string;
}

/**
 * PI label renderer. The Markdown parser is only used for known inline syntax;
 * ordinary angle-bracket text therefore stays intact instead of being treated
 * as HTML. React Markdown additionally unwraps block nodes so malformed labels
 * cannot introduce layout into compact controls.
 */
export function InlineMarkdownLabel({
  text,
  className,
}: InlineMarkdownLabelProps) {
  if (!hasInlineRichText(text)) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className ? `rich-label ${className}` : "rich-label"}>
      <Markdown
        allowedElements={inlineMarkdownElements}
        unwrapDisallowed
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeRaw,
          rehypeSanitizeInlineStyles,
          [rehypeSanitize, sanitizeSchema],
        ]}
        components={{ a: MarkdownLink, img: MarkdownImage }}
      >
        {text}
      </Markdown>
    </span>
  );
}
