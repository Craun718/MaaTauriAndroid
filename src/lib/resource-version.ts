export function resolveResourceVersion(
  projectVersion?: string,
  resourceTag?: string,
): string | undefined {
  return projectVersion?.trim() || resourceTag?.trim() || undefined;
}
