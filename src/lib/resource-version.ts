export function resolveResourceVersion(
  resourceTag?: string,
): string | undefined {
  return resourceTag?.trim() || undefined;
}
