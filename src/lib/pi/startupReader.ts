import { type ProjectTextReadResult, readProjectTextResults } from "../api";
import { metadataTextPaths } from "./adapter";
import { parseJsonc } from "./jsonc";
import { isRawObject } from "./loader";
import type { ProjectSource } from "./rawTypes";

export interface StartupProjectTextReader {
  (relativePath: string): Promise<string>;
  preloadInterface(interfacePath: string): Promise<void>;
  preloadMetadata(
    source: ProjectSource,
    preferredLanguage: string,
  ): Promise<void>;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
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

function localePaths(value: unknown): string[] {
  if (!isRawObject(value)) return [];
  return Object.values(value).filter(
    (item): item is string => typeof item === "string",
  );
}

function validResult(result: ProjectTextReadResult): string {
  if (result.error != null) throw new Error(result.error);
  if (typeof result.text !== "string") {
    throw new Error(`Project Interface text read had no body: ${result.path}`);
  }
  return result.text;
}

export function createStartupProjectTextReader(): StartupProjectTextReader {
  const cache = new Map<string, string>();

  async function request(
    paths: readonly string[],
  ): Promise<Map<string, string>> {
    const pending = [...new Set(paths.filter((path) => !cache.has(path)))];
    if (pending.length === 0) return new Map();

    const results = await readProjectTextResults(pending);
    const texts = new Map<string, string>();
    for (const result of results) {
      const text = validResult(result);
      texts.set(result.path, text);
      cache.set(result.path, text);
    }
    return texts;
  }

  async function reader(path: string): Promise<string> {
    await request([path]);
    return cache.get(path) as string;
  }

  reader.preloadInterface = async function preloadInterface(
    interfacePath: string,
  ): Promise<void> {
    const interfaceTexts = await request([interfacePath]);
    const interfaceDocument = parseJsonc(
      interfaceTexts.get(interfacePath) ?? (cache.get(interfacePath) as string),
      interfacePath,
    );

    const visited = new Set([pathKey(interfacePath)]);
    let imports = stringArray(
      isRawObject(interfaceDocument) ? interfaceDocument.import : undefined,
    );
    const languages = isRawObject(interfaceDocument)
      ? interfaceDocument.languages
      : undefined;
    const locales = localePaths(languages);
    let importedTexts = new Map<string, string>();
    if (imports.length > 0 || locales.length > 0) {
      importedTexts = await request([...imports, ...locales]);
    }
    while (imports.length > 0) {
      const nestedImports: string[] = [];
      for (const importPath of imports) {
        const key = pathKey(importPath);
        if (visited.has(key)) continue;
        visited.add(key);

        const document = parseJsonc(
          importedTexts.get(importPath) ?? (cache.get(importPath) as string),
          importPath,
        );
        if (!isRawObject(document)) continue;
        nestedImports.push(
          ...stringArray(document.import).filter(
            (childPath) => !visited.has(pathKey(childPath)),
          ),
        );
      }
      if (nestedImports.length > 0) {
        importedTexts = await request(nestedImports);
      }
      imports = [...new Set(nestedImports)];
    }
  };

  reader.preloadMetadata = async function preloadMetadata(
    source: ProjectSource,
    preferredLanguage: string,
  ): Promise<void> {
    const pending = metadataTextPaths(source, preferredLanguage).filter(
      (path) => !cache.has(path),
    );
    if (pending.length === 0) return;

    // Description and local welcome files are optional: the adapter keeps
    // the declared path when a body cannot be read.
    try {
      const results = await readProjectTextResults(pending);
      for (const result of results) {
        if (result.error == null && typeof result.text === "string") {
          cache.set(result.path, result.text);
        }
      }
    } catch {
      // A whole-batch transport failure falls back to the adapter's normal
      // per-file error handling.
    }
  };

  return reader;
}
