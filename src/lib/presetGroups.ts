import type { ConfigurationTemplate, GroupDefinition } from "./types";

export interface PresetGroup {
  /** Interface group name; an empty name is the fallback group. */
  name: string;
  label: string;
  presets: ConfigurationTemplate[];
}

/**
 * Groups presets in interface order, keeping the first appearance of each
 * group. Presets without a group fall into a trailing fallback group.
 */
export function presetGroups(
  presets: ConfigurationTemplate[],
  groups: GroupDefinition[] = [],
  fallbackLabel = "",
): PresetGroup[] {
  const labels = new Map(groups.map((group) => [group.name, group.label]));
  const result: PresetGroup[] = [];
  const byName = new Map<string, PresetGroup>();

  for (const preset of presets) {
    const name = preset.group ?? "";
    let group = byName.get(name);
    if (!group) {
      group = {
        name,
        label: name ? (labels.get(name) ?? name) : fallbackLabel,
        presets: [],
      };
      byName.set(name, group);
      result.push(group);
    }
    group.presets.push(preset);
  }
  return result;
}
