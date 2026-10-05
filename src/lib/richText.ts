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

const allowedStyleProperties = new Set([
  "align-items",
  "aspect-ratio",
  "background",
  "background-color",
  "background-position",
  "background-repeat",
  "background-size",
  "border",
  "border-color",
  "border-radius",
  "border-width",
  "bottom",
  "box-shadow",
  "color",
  "column-gap",
  "display",
  "flex",
  "flex-basis",
  "flex-direction",
  "flex-grow",
  "flex-shrink",
  "flex-wrap",
  "font-size",
  "font-style",
  "font-weight",
  "gap",
  "height",
  "inset",
  "justify-content",
  "left",
  "line-height",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "object-fit",
  "opacity",
  "overflow",
  "overflow-wrap",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "pointer-events",
  "position",
  "right",
  "row-gap",
  "table-layout",
  "text-align",
  "text-decoration",
  "text-overflow",
  "text-shadow",
  "top",
  "transform",
  "vertical-align",
  "white-space",
  "width",
  "word-break",
]);

type StyleNode = {
  properties?: Record<string, unknown>;
  children?: StyleNode[];
};

function splitStyleDeclarations(style: string): string[] {
  const declarations: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let parentheses = 0;

  for (const character of style) {
    if (quote) {
      if (character === quote) quote = undefined;
      current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === "(") parentheses += 1;
    if (character === ")") parentheses -= 1;
    if (character === ";" && parentheses === 0) {
      declarations.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  declarations.push(current);
  return declarations;
}

function isSafeStyleValue(value: string): boolean {
  if (value.length > 500) return false;
  const lower = value.toLowerCase();
  const unsafeTokens = [
    "<",
    ">",
    "\\",
    '"',
    "'",
    "{",
    "}",
    "/*",
    "*/",
    "url(",
    "image-set(",
    "expression(",
    "javascript:",
    "vbscript:",
  ].some((forbidden) => lower.includes(forbidden));
  return !unsafeTokens && !/\b(?:url|image-set|expression)\s*\(/i.test(value);
}

function isSafeDeclarationValue(property: string, value: string): boolean {
  if (!isSafeStyleValue(value)) return false;
  if (property === "display") {
    return [
      "block",
      "flex",
      "grid",
      "inline",
      "inline-block",
      "inline-flex",
      "none",
    ].includes(value.toLowerCase());
  }
  if (property === "overflow") {
    return ["auto", "hidden", "scroll", "visible"].includes(
      value.toLowerCase(),
    );
  }
  if (property === "pointer-events") {
    return ["auto", "none"].includes(value.toLowerCase());
  }
  if (property === "position") {
    return ["absolute", "relative", "static", "sticky"].includes(
      value.toLowerCase(),
    );
  }
  return true;
}

export function sanitizeInlineStyle(style: string): string {
  if (style.length > 4000) return "";
  return splitStyleDeclarations(style)
    .slice(0, 64)
    .flatMap((declaration) => {
      const separator = declaration.indexOf(":");
      if (separator < 0) return [];
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const value = declaration.slice(separator + 1).trim();
      if (!property || !value) return [];
      if (!allowedStyleProperties.has(property)) return [];
      if (!isSafeDeclarationValue(property, value)) return [];
      return [`${property}: ${value}`];
    })
    .join("; ");
}

function sanitizeNodeStyles(node: StyleNode): void {
  if (node.properties && typeof node.properties.style === "string") {
    const sanitized = sanitizeInlineStyle(node.properties.style);
    if (sanitized) node.properties.style = sanitized;
    else delete node.properties.style;
  }
  for (const child of node.children ?? []) sanitizeNodeStyles(child);
}

export function rehypeSanitizeInlineStyles() {
  return (tree: StyleNode) => {
    sanitizeNodeStyles(tree);
  };
}

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
