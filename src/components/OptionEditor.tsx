import { useTranslation } from "../lib/i18n";
import { defaultOptionValue, switchCases } from "../lib/options";
import type { OptionDefinition, OptionValue } from "../lib/types";
import { RichDescription } from "./RichDescription";
import { Checkbox } from "./ui/Checkbox";
import { SegmentGroup } from "./ui/SegmentGroup";
import { Select } from "./ui/Select";
import { TextField } from "./ui/TextField";

interface OptionEditorProps {
  option: OptionDefinition;
  value?: OptionValue;
  onChange: (value: OptionValue) => void;
}

export function OptionEditor({ option, value, onChange }: OptionEditorProps) {
  const { t } = useTranslation();

  if (option.kind === "switch") {
    // A switch is one boolean, not a choice of two labels: the protocol fixes
    // it at two cases, one named Yes and one No. So it renders as a single
    // checkbox carrying the option's own label, and the case names only decide
    // which value a tick writes.
    const pair = switchCases(option);
    if (pair) {
      // Same fallback the resolver uses for an untouched option, so an
      // undeclared `default_case` shows the case that will actually run.
      const effective = defaultOptionValue(option, value);
      return (
        <div className="space-y-2">
          <Checkbox
            className="min-h-11 gap-3 rounded-md border border-line px-3"
            checked={effective.type === "single" && effective.case === pair.on}
            onCheckedChange={(next) =>
              onChange({ type: "single", case: next ? pair.on : pair.off })
            }
          >
            {option.label}
          </Checkbox>
          <RichDescription text={option.description} />
        </div>
      );
    }
  }

  if (option.kind === "select") {
    // PI protocol defines `select` as a dropdown with one selected case. The
    // native control keeps touch behaviour consistent with the other pickers;
    // case descriptions are shown for the current choice because <option>
    // cannot render rich content.
    const effective = defaultOptionValue(option, value);
    const selected = effective.type === "single" ? effective.case : undefined;
    const selectedCase = option.cases.find((item) => item.name === selected);
    return (
      <div className="space-y-3">
        <div>
          <p id={`option-label-${option.name}`} className="font-medium">
            {option.label}
          </p>
          <RichDescription text={option.description} />
        </div>
        <Select
          labelledBy={`option-label-${option.name}`}
          value={selected}
          items={option.cases.map((item) => ({
            value: item.name,
            label: item.label,
          }))}
          onValueChange={(caseName) =>
            onChange({ type: "single", case: caseName })
          }
        />
        {selectedCase?.description && (
          <RichDescription text={selectedCase.description} />
        )}
      </div>
    );
  }

  if (option.kind === "switch") {
    // A switch that is not a Yes/No pair — a malformed one, or a project that
    // named its cases itself. Listing them is all we can do: we have no way to
    // say which one is the "on" position.
    const selected = value?.type === "single" ? value.case : option.defaultCase;
    return (
      <SegmentGroup
        label={option.label}
        description={
          option.description ? (
            <RichDescription text={option.description} />
          ) : undefined
        }
        value={selected}
        columns={Math.min(option.cases.length, 3)}
        items={option.cases.map((item) => ({
          value: item.name,
          label: item.label,
          description: item.description ? (
            <RichDescription text={item.description} className="text-xs" />
          ) : undefined,
        }))}
        onValueChange={(caseName) =>
          onChange({ type: "single", case: caseName })
        }
      />
    );
  }

  if (option.kind === "checkbox") {
    const selected =
      value?.type === "multiple" ? value.cases : option.defaultCases;
    return (
      <div className="space-y-3">
        <div>
          <p className="font-medium">{option.label}</p>
          <RichDescription text={option.description} />
        </div>
        <div className="space-y-2">
          {option.cases.map((item) => {
            const checked = selected.includes(item.name);
            return (
              <Checkbox
                key={item.name}
                className="min-h-11 gap-3 rounded-md border border-line px-3"
                checked={checked}
                onCheckedChange={(next) => {
                  onChange({
                    type: "multiple",
                    cases: next
                      ? [...selected, item.name]
                      : selected.filter((name) => name !== item.name),
                  });
                }}
              >
                <span className="flex flex-col items-start gap-0.5 text-left">
                  <span className="font-medium">{item.label}</span>
                  <RichDescription
                    text={item.description}
                    className="text-xs"
                  />
                </span>
              </Checkbox>
            );
          })}
        </div>
      </div>
    );
  }

  const fields: Array<{
    name: string;
    label: string;
    description?: string;
    default?: string;
    password?: boolean;
    pipelineType?: "string" | "int" | "bool";
    verify?: string;
    patternMessage?: string;
  }> = option.kind === "input" ? option.inputs : option.hotkeys;
  const values = value?.type === "inputs" ? value.values : {};
  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">{option.label}</p>
        <RichDescription text={option.description} />
      </div>
      {fields.map((field) => {
        if (option.kind === "input" && field.pipelineType === "bool") {
          const checked = (values[field.name] ?? field.default) === "true";
          return (
            <Checkbox
              key={field.name}
              className="min-h-11 gap-3 rounded-md border border-line px-3"
              checked={checked}
              onCheckedChange={(next) =>
                onChange({
                  type: "inputs",
                  values: { ...values, [field.name]: next ? "true" : "false" },
                })
              }
            >
              <span className="flex flex-col items-start gap-0.5 text-left">
                <span>{field.label}</span>
                <RichDescription text={field.description} className="text-xs" />
              </span>
            </Checkbox>
          );
        }
        const current = values[field.name] ?? field.default ?? "";
        const patternError =
          option.kind === "input" && field.verify && current.length > 0
            ? matchesPattern(current, field.verify)
              ? undefined
              : (field.patternMessage ?? t("invalidInput"))
            : undefined;
        return (
          <TextField
            key={field.name}
            label={field.label}
            type={
              option.kind === "input" && field.password ? "password" : "text"
            }
            inputMode={
              option.kind === "input" && field.pipelineType === "int"
                ? "numeric"
                : undefined
            }
            value={current}
            error={patternError}
            description={
              field.description ? (
                <RichDescription text={field.description} />
              ) : undefined
            }
            onValueChange={(next) =>
              onChange({
                type: "inputs",
                values: { ...values, [field.name]: next },
              })
            }
          />
        );
      })}
    </div>
  );
}

function matchesPattern(value: string, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return true;
  }
}
