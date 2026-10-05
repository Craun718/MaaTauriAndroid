import { parseJsonc } from "./jsonc";
import type {
  ProjectSource,
  ProjectTextReader,
  RawImportFragment,
  RawJsonObject,
  RawProjectInterface,
} from "./rawTypes";

const MERGED_ARRAYS = [
  "task",
  "preset",
  "group",
  "setting",
  "pretask",
  "global_option",
] as const;

export function isRawObject(value: unknown): value is RawJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: RawProjectInterface | RawImportFragment) {
  return value as RawJsonObject;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function mergeFragment(
  base: RawProjectInterface,
  imported: RawImportFragment,
): RawProjectInterface {
  const result: RawJsonObject = { ...asObject(base) };
  for (const key of MERGED_ARRAYS) {
    const incoming = imported[key];
    if (!Array.isArray(incoming)) continue;
    const existing = result[key];
    result[key] = Array.isArray(existing)
      ? [...existing, ...incoming]
      : incoming;
  }

  const incomingOptions = imported.option;
  if (isRawObject(incomingOptions)) {
    const existing = result.option;
    result.option = isRawObject(existing)
      ? { ...existing, ...incomingOptions }
      : incomingOptions;
  }
  return result as RawProjectInterface;
}

function pathKey(path: string): string {
  const parts: string[] = [];
  for (const component of path.split(/[\\/]+/)) {
    if (!component || component === ".") continue;
    if (component === "..") {
      if (parts.length > 0) parts.pop();
      continue;
    }
    parts.push(component);
  }
  return parts.join("/");
}

async function mergeImports(
  document: RawProjectInterface,
  readFile: ProjectTextReader,
): Promise<RawProjectInterface> {
  const stack = new Set<string>();

  async function mergeChild(
    child: RawImportFragment,
    childPath: string,
  ): Promise<RawImportFragment> {
    if (stack.has(pathKey(childPath))) return child;
    stack.add(pathKey(childPath));
    let result = child;
    for (const importPath of stringArray(child.import)) {
      if (stack.has(pathKey(importPath))) continue;
      const raw = parseJsonc(await readFile(importPath), importPath);
      if (!isRawObject(raw)) {
        throw new Error(`import must contain a JSON object: ${importPath}`);
      }
      const imported = await mergeChild(raw, importPath);
      result = mergeFragment(result, imported) as RawImportFragment;
    }
    stack.delete(pathKey(childPath));
    return result;
  }

  let result = document;
  for (const importPath of stringArray(document.import)) {
    if (stack.has(pathKey(importPath))) continue;
    const raw = parseJsonc(await readFile(importPath), importPath);
    if (!isRawObject(raw)) {
      throw new Error(`import must contain a JSON object: ${importPath}`);
    }
    const imported = await mergeChild(raw, importPath);
    result = mergeFragment(result, imported);
  }
  return result;
}

async function loadTranslations(
  document: RawProjectInterface,
  readFile: ProjectTextReader,
): Promise<Record<string, Record<string, string>>> {
  const result: Record<string, Record<string, string>> = {};
  const languages = document.languages;
  if (!isRawObject(languages)) return result;

  for (const language of Object.keys(languages).sort(compareUtf8)) {
    const path = languages[language];
    if (typeof path !== "string") continue;
    const raw = parseJsonc(await readFile(path), path);
    if (!isRawObject(raw)) {
      result[language] = {};
      continue;
    }
    const values: Record<string, string> = {};
    for (const key of Object.keys(raw).sort(compareUtf8)) {
      const value = raw[key];
      if (typeof value === "string") values[key] = value;
    }
    result[language] = values;
  }
  return result;
}

export function compareUtf8(left: string, right: string): number {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) {
      return leftBytes[index] - rightBytes[index];
    }
  }
  return leftBytes.length - rightBytes.length;
}

export async function loadProjectSource(
  root: string,
  readFile: ProjectTextReader,
  interfacePath = "interface.json",
): Promise<ProjectSource> {
  const raw = parseJsonc(await readFile(interfacePath), interfacePath);
  if (!isRawObject(raw)) {
    throw new Error(`interface must contain a JSON object: ${interfacePath}`);
  }
  const document = await mergeImports(raw as RawProjectInterface, readFile);
  const translations = await loadTranslations(document, readFile);
  const languages = isRawObject(document.languages)
    ? Object.keys(document.languages).sort(compareUtf8)
    : [];
  return { root, document, languages, translations };
}
