import { describe, expect, it } from "vitest";
import { selectedCaseNames, switchCases, visibleOptions } from "./options";
import type { OptionDefinition, OptionValue } from "./types";

const applicability = { controllers: [], resources: [] };

/** A switch whose cases own the given options. */
function branch(
  name: string,
  defaultCase: string,
  cases: Record<string, string[]>,
): OptionDefinition {
  return {
    kind: "switch",
    name,
    label: name,
    cases: Object.entries(cases).map(([caseName, options]) => ({
      name: caseName,
      label: caseName,
      options,
    })),
    defaultCase,
    applicability,
  };
}

function field(name: string): OptionDefinition {
  return {
    kind: "input",
    name,
    label: name,
    inputs: [
      {
        name: "value",
        label: "Value",
        pipelineType: "string",
        password: false,
      },
    ],
    applicability,
  };
}

const sugar = branch("eatSugar", "No", { No: [], Yes: ["customCount"] });
const customCount = branch("customCount", "No", { No: [], Yes: ["count"] });
const count = field("count");
const definitions: Record<string, OptionDefinition> = {
  eatSugar: sugar,
  customCount,
  count,
  plain: branch("plain", "a", { a: [], b: [] }),
};

const single = (optionCase: string): OptionValue => ({
  type: "single",
  case: optionCase,
});

describe("visibleOptions", () => {
  it("lists a declared option on its own when no case owns anything", () => {
    expect(visibleOptions(definitions, ["plain"])).toEqual([
      { name: "plain", depth: 0 },
    ]);
  });

  it("shows the options owned by the case that is selected by default", () => {
    const yes = {
      ...definitions,
      eatSugar: branch("eatSugar", "Yes", { No: [], Yes: ["customCount"] }),
    };

    expect(visibleOptions(yes, ["eatSugar"])).toEqual([
      { name: "eatSugar", depth: 0 },
      { name: "customCount", depth: 1 },
    ]);
  });

  it("leaves out the options of a case that is not selected", () => {
    // The whole point: `count` lives under customCount's Yes case only, and no
    // task declares it, so nothing would ever render it without this walk.
    expect(
      visibleOptions(definitions, ["eatSugar"]).map((item) => item.name),
    ).toEqual(["eatSugar"]);
  });

  it("follows the stored choice rather than the default", () => {
    const visible = visibleOptions(definitions, ["eatSugar"], {
      eatSugar: single("Yes"),
      customCount: single("Yes"),
    });

    expect(visible).toEqual([
      { name: "eatSugar", depth: 0 },
      { name: "customCount", depth: 1 },
      { name: "count", depth: 2 },
    ]);
  });

  it("drops the nested options again when the choice is turned off", () => {
    const visible = visibleOptions(definitions, ["eatSugar"], {
      eatSugar: single("Yes"),
      customCount: single("No"),
    });

    expect(visible.map((item) => item.name)).toEqual([
      "eatSugar",
      "customCount",
    ]);
  });

  it("collects the options of every selected case of a checkbox", () => {
    const checkbox: OptionDefinition = {
      kind: "checkbox",
      name: "extras",
      label: "Extras",
      cases: [
        { name: "one", label: "one", options: ["childOne"] },
        { name: "two", label: "two", options: ["childTwo"] },
        { name: "three", label: "three", options: ["childThree"] },
      ],
      defaultCases: ["one", "two"],
      applicability,
    };
    const defs = {
      ...definitions,
      extras: checkbox,
      childOne: field("childOne"),
      childTwo: field("childTwo"),
      childThree: field("childThree"),
    };

    expect(visibleOptions(defs, ["extras"]).map((item) => item.name)).toEqual([
      "extras",
      "childOne",
      "childTwo",
    ]);
  });

  it("falls back to a select's first case the way the resolver does", () => {
    const select: OptionDefinition = {
      kind: "select",
      name: "mode",
      label: "Mode",
      cases: [
        { name: "auto", label: "auto", options: ["autoDetail"] },
        { name: "manual", label: "manual", options: ["manualDetail"] },
      ],
      applicability,
    };
    const defs = {
      ...definitions,
      mode: select,
      autoDetail: field("autoDetail"),
      manualDetail: field("manualDetail"),
    };

    // A select with no default_case: the resolver merges "auto"'s children.
    expect(visibleOptions(defs, ["mode"]).map((item) => item.name)).toEqual([
      "mode",
      "autoDetail",
    ]);
  });

  it("renders an option shared by two cases only once", () => {
    const defs = {
      ...definitions,
      left: branch("left", "on", { on: ["shared"] }),
      right: branch("right", "on", { on: ["shared"] }),
      shared: field("shared"),
    };

    expect(visibleOptions(defs, ["left", "right"])).toEqual([
      { name: "left", depth: 0 },
      { name: "shared", depth: 1 },
      { name: "right", depth: 0 },
    ]);
  });

  it("renders a name owned by a selected case under that case, not at the root", () => {
    const yes = {
      ...definitions,
      eatSugar: branch("eatSugar", "Yes", { No: [], Yes: ["customCount"] }),
    };

    expect(visibleOptions(yes, ["eatSugar", "customCount"])).toEqual([
      { name: "eatSugar", depth: 0 },
      { name: "customCount", depth: 1 },
    ]);
  });

  it("ignores names that were never declared", () => {
    expect(visibleOptions(definitions, ["ghost", "plain"])).toEqual([
      { name: "plain", depth: 0 },
    ]);
  });

  it("terminates when a case owns the option that declares it", () => {
    const loop = branch("loop", "on", { on: ["loop"] });

    expect(visibleOptions({ loop }, ["loop"])).toEqual([
      { name: "loop", depth: 0 },
    ]);
  });
});

describe("selectedCaseNames", () => {
  it("reports the default case of an unset switch", () => {
    expect(selectedCaseNames(sugar)).toEqual(["No"]);
  });

  it("reports nothing for an option with no cases", () => {
    expect(selectedCaseNames(count)).toEqual([]);
  });
});

describe("switchCases", () => {
  const twoCases = (names: string[]): OptionDefinition => ({
    kind: "switch",
    name: "s",
    label: "s",
    cases: names.map((name) => ({ name, label: name, options: [] })),
    applicability,
  });

  it("reads Yes/No no matter which one is declared first", () => {
    expect(switchCases(twoCases(["Yes", "No"]))).toEqual({
      on: "Yes",
      off: "No",
    });
    expect(switchCases(twoCases(["No", "Yes"]))).toEqual({
      on: "Yes",
      off: "No",
    });
    expect(switchCases(sugar)).toEqual({ on: "Yes", off: "No" });
  });

  it("accepts the short spellings the protocol lists", () => {
    expect(switchCases(twoCases(["Y", "n"]))).toEqual({ on: "Y", off: "n" });
  });

  it("accepts the on/off spellings other clients treat as boolean", () => {
    expect(switchCases(twoCases(["Enable", "Disable"]))).toEqual({
      on: "Enable",
      off: "Disable",
    });
  });

  it("gives up when the names do not say which side is on", () => {
    expect(switchCases(twoCases(["开", "关"]))).toBeUndefined();
    expect(switchCases(twoCases(["Yes", "Whatever"]))).toBeUndefined();
  });

  it("gives up on anything that is not a two-case switch", () => {
    expect(switchCases(twoCases(["Yes", "No", "Maybe"]))).toBeUndefined();
    expect(switchCases(twoCases(["Yes"]))).toBeUndefined();
    expect(switchCases(count)).toBeUndefined();
  });
});
