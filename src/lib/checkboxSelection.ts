import type { OptionDefinition, OptionValue } from "./types";

type CheckboxOption = Extract<OptionDefinition, { kind: "checkbox" }>;

export interface CheckboxSelectionState {
  selected: string[];
  atMaximum: boolean;
  minimumRequired?: number;
}

/** Defaults remain visible even when they do not satisfy the declared bounds. */
export function checkboxSelectionState(
  option: CheckboxOption,
  value?: OptionValue,
): CheckboxSelectionState {
  const selected =
    value?.type === "multiple" ? value.cases : option.defaultCases;
  return {
    selected,
    atMaximum:
      option.maxCount !== undefined && selected.length >= option.maxCount,
    minimumRequired:
      option.minCount !== undefined && selected.length < option.minCount
        ? option.minCount
        : undefined,
  };
}

/** Enforce max on additions; min is a validation hint, so removal stays possible. */
export function updateCheckboxSelection(
  option: CheckboxOption,
  selected: string[],
  caseName: string,
  checked: boolean,
): string[] {
  if (!checked) return selected.filter((name) => name !== caseName);
  if (
    selected.includes(caseName) ||
    !option.cases.some((item) => item.name === caseName) ||
    (option.maxCount !== undefined && selected.length >= option.maxCount)
  ) {
    return selected;
  }
  return [...selected, caseName];
}
