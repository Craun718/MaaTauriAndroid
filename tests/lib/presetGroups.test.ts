import { describe, expect, it } from "vitest";
import { presetGroups } from "../../src/lib/presetGroups";
import type {
  ConfigurationTemplate,
  GroupDefinition,
} from "../../src/lib/types";

const preset = (name: string, group?: string): ConfigurationTemplate => ({
  name,
  label: name,
  tasks: [],
  ...(group ? { group } : {}),
});

const groups: GroupDefinition[] = [
  { name: "daily", label: "Daily", defaultExpand: true },
  { name: "weekly", label: "Weekly", defaultExpand: true },
];

describe("presetGroups", () => {
  it("keeps interface group order and first group appearance", () => {
    const grouped = presetGroups(
      [
        preset("b", "weekly"),
        preset("a", "daily"),
        preset("c", "daily"),
        preset("d", "weekly"),
      ],
      groups,
    );

    expect(grouped.map((group) => group.name)).toEqual(["weekly", "daily"]);
    expect(grouped[1].presets.map((preset) => preset.name)).toEqual(["a", "c"]);
  });

  it("falls back to a trailing default group for ungrouped presets", () => {
    const grouped = presetGroups(
      [preset("a", "daily"), preset("b"), preset("c", "daily")],
      groups,
      "Default",
    );

    expect(grouped.map((group) => group.name)).toEqual(["daily", ""]);
    expect(grouped[0].label).toBe("Daily");
    expect(grouped[1].label).toBe("Default");
    expect(grouped[1].presets.map((preset) => preset.name)).toEqual(["b"]);
  });
});
