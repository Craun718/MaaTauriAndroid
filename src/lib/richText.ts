const inlineImageOrLink = /!?\[[^\]]*\]\([^)]*\)/;
const inlineCode = /`[^`]+`/;
const inlineStrong = /\*\*[^*]+\*\*/;
export const inlineHtmlTagNames = [
  "a",
  "b",
  "br",
  "code",
  "em",
  "font",
  "i",
  "img",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
];
const inlineHtmlTag = new RegExp(
  `<(?:${inlineHtmlTagNames.join("|")})\\b[^>]*>`,
  "i",
);
const inlineHtmlTagAny = new RegExp(
  `</?(?:${inlineHtmlTagNames.join("|")})\\b[^>]*>`,
  "gi",
);

export function hasInlineRichText(text: string): boolean {
  return (
    inlineImageOrLink.test(text) ||
    inlineCode.test(text) ||
    inlineStrong.test(text) ||
    inlineHtmlTag.test(text)
  );
}

export function stripInlineRichText(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(inlineHtmlTagAny, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
