import type { ComponentPropsWithoutRef, MouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

const sanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
};

type MarkdownLinkProps = ComponentPropsWithoutRef<"a"> & { node?: unknown };

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
        components={{ a: MarkdownLink }}
      >
        {text}
      </Markdown>
    </div>
  );
}
