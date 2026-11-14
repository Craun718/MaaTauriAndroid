import { describe, expect, it } from "vitest";
import {
  checkboxSelectionState,
  updateCheckboxSelection,
} from "./checkboxSelection";
import type { OptionDefinition } from "./types";

type CheckboxOption = Extract<OptionDefinition, { kind: "checkbox" }>;
const option: CheckboxOption = {
  kind: "checkbox",
  name: "extras",
  label: "Extras",
  cases: ["a", "b", "c"].map((name) => ({ name, label: name, options: [] })),
  defaultCases: ["a"],
  applicability: { controllers: [], resources: [] },
};

describe("checkbox selection constraints", () => {
  it("uses defaults and reports an unmet minimum without filling selections", () => {
    expect(checkboxSelectionState({ ...option, minCount: 2 })).toEqual({
      selected: ["a"],
      atMaximum: false,
      minimumRequired: 2,
    });
    expect(option.defaultCases).toEqual(["a"]);
  });

  it("preserves an explicitly empty selection instead of restoring defaults", () => {
    expect(
      checkboxSelectionState(
        { ...option, minCount: 1 },
        { type: "multiple", cases: [] },
      ),
    ).toEqual({
      selected: [],
      atMaximum: false,
      minimumRequired: 1,
    });
  });

  it("clears the minimum hint exactly at the minimum", () => {
    expect(
      checkboxSelectionState({ ...option, minCount: 1 }).minimumRequired,
    ).toBeUndefined();
    expect(
      checkboxSelectionState(
        { ...option, minCount: 0 },
        { type: "multiple", cases: [] },
      ).minimumRequired,
    ).toBeUndefined();
  });

  it("allows additions below max and rejects additions at max", () => {
    const bounded = { ...option, maxCount: 2 };
    const original = ["a"];
    const selected = updateCheckboxSelection(bounded, original, "b", true);
    expect(selected).toEqual(["a", "b"]);
    expect(original).toEqual(["a"]);
    expect(
      checkboxSelectionState(bounded, { type: "multiple", cases: selected })
        .atMaximum,
    ).toBe(true);
    expect(updateCheckboxSelection(bounded, selected, "c", true)).toEqual([
      "a",
      "b",
    ]);
  });

  it("allows removals below min so the user can replace selected cases", () => {
    const bounded = { ...option, minCount: 1, maxCount: 1 };
    const selected = updateCheckboxSelection(bounded, ["a"], "a", false);
    expect(selected).toEqual([]);
    expect(
      checkboxSelectionState(bounded, { type: "multiple", cases: selected }),
    ).toEqual({
      selected: [],
      atMaximum: false,
      minimumRequired: 1,
    });
    expect(updateCheckboxSelection(bounded, selected, "b", true)).toEqual([
      "b",
    ]);
  });

  it("treats zero max as a real bound", () => {
    const bounded = { ...option, defaultCases: [], maxCount: 0 };
    expect(checkboxSelectionState(bounded).atMaximum).toBe(true);
    expect(updateCheckboxSelection(bounded, [], "a", true)).toEqual([]);
  });

  it("keeps over-limit defaults intact and allows reducing them", () => {
    const bounded = { ...option, defaultCases: ["a", "b"], maxCount: 1 };
    expect(checkboxSelectionState(bounded).selected).toEqual(["a", "b"]);
    expect(checkboxSelectionState(bounded).atMaximum).toBe(true);
    expect(
      updateCheckboxSelection(bounded, bounded.defaultCases, "c", true),
    ).toEqual(["a", "b"]);
    expect(
      updateCheckboxSelection(bounded, bounded.defaultCases, "a", false),
    ).toEqual(["b"]);
  });

  it("allows all declared cases when unbounded, without adding duplicates or unknown cases", () => {
    const selected = ["a", "b"];
    expect(
      checkboxSelectionState(option, { type: "multiple", cases: selected })
        .atMaximum,
    ).toBe(false);
    expect(updateCheckboxSelection(option, selected, "c", true)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(updateCheckboxSelection(option, selected, "a", true)).toEqual(
      selected,
    );
    expect(updateCheckboxSelection(option, selected, "unknown", true)).toEqual(
      selected,
    );
  });
});
