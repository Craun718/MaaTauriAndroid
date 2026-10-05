import type { UiLanguage } from "./types";

/** Language the interface actually renders in, after resolving "system". */
export type AppLanguage = "zh" | "en";

/**
 * Locale tags the device reports, most preferred first. Android's WebView and
 * the desktop webviews both expose the device setting here, so no native bridge
 * is needed.
 */
export function systemLanguageTags(): string[] {
  if (typeof navigator === "undefined") return [];
  const tags: string[] = [];
  if (navigator.language) tags.push(navigator.language);
  for (const tag of navigator.languages ?? []) {
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/** "zh", "zh-CN", "zh-Hans-CN" and "zh_TW" all count as Chinese; nothing else does. */
export function isChineseLocale(tag: string | undefined): boolean {
  return typeof tag === "string" && tag.trim().toLowerCase().startsWith("zh");
}

/** Explicit choice wins; "system" (and a missing value) follows the device locale. */
export function resolveLanguage(
  setting: UiLanguage | undefined,
  tags: readonly string[],
): AppLanguage {
  if (setting === "zh" || setting === "en") return setting;
  return isChineseLocale(tags[0]) ? "zh" : "en";
}

/** Language a project's own labels should be loaded in. */
export function projectLanguage(language: AppLanguage): string {
  return language === "zh" ? "zh_cn" : "en_us";
}
