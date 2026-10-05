import { type ParseError, parse, printParseErrorCode } from "jsonc-parser";
import type { RawJsonValue } from "./rawTypes";

export function parseJsonc(content: string, sourceName: string): RawJsonValue {
  const errors: ParseError[] = [];
  const value = parse(content, errors, {
    allowTrailingComma: true,
  }) as RawJsonValue | undefined;

  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(
      `could not parse ${sourceName}: ${printParseErrorCode(first.error)} at offset ${first.offset}`,
    );
  }
  if (value === undefined) {
    throw new Error(`could not parse ${sourceName}: value expected`);
  }
  return value;
}
