import type { OptionDefinition, OptionValue } from "../lib/types";
import { defaultOptionValue, switchCases } from "../lib/options";
import { Checkbox } from "./ui/Checkbox";
import { SegmentGroup } from "./ui/SegmentGroup";
import { TextField } from "./ui/TextField";

interface OptionEditorProps {
  option: OptionDefinition;
  value?: OptionValue;
  onChange: (value: OptionValue) => void;
}

export function OptionEditor({ option, value, onChange }: OptionEditorProps) {
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
            className="min-h-11 gap-3 rounded-md border border-[var(--border)] px-3"
            checked={effective.type === "single" && effective.case === pair.on}
            onCheckedChange={(next) =>
              onChange({ type: "single", case: next ? pair.on : pair.off })
            }
          >
            {option.label}
          </Checkbox>
          {option.description && (
            <p className="text-sm text-[var(--text-muted)]">{option.description}</p>
          )}
        </div>
      );
    }
  }

  if (option.kind === "select" || option.kind === "switch") {
    // `select`, plus the switch that is not a Yes/No pair — a malformed one, or
    // a project that named its cases itself. Listing them is all we can do: we
    // have no way to say which one is the "on" position.
    const selected = value?.type === "single" ? value.case : option.defaultCase;
    return (
      <SegmentGroup
        label={option.label}
        description={option.description}
        value={selected}
        columns={Math.min(option.cases.length, 3)}
        items={option.cases.map((item) => ({ value: item.name, label: item.label }))}
        onValueChange={(caseName) => onChange({ type: "single", case: caseName })}
      />
    );
  }

  if (option.kind === "checkbox") {
    const selected = value?.type === "multiple" ? value.cases : option.defaultCases;
    return (
      <div className="space-y-3">
        <div>
          <p className="font-medium">{option.label}</p>
          {option.description && (
            <p className="text-sm text-[var(--text-muted)]">{option.description}</p>
          )}
        </div>
        <div className="space-y-2">
          {option.cases.map((item) => {
            const checked = selected.includes(item.name);
            return (
              <Checkbox
                key={item.name}
                className="min-h-11 gap-3 rounded-md border border-[var(--border)] px-3"
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
                {item.label}
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
  }> = option.kind === "input" ? option.inputs : option.hotkeys;
  const values = value?.type === "inputs" ? value.values : {};
  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">{option.label}</p>
        {option.description && (
          <p className="text-sm text-[var(--text-muted)]">{option.description}</p>
        )}
      </div>
      {fields.map((field) => (
        <TextField
          key={field.name}
          label={field.label}
          type={option.kind === "input" && field.password ? "password" : "text"}
          value={values[field.name] ?? field.default ?? ""}
          onValueChange={(next) =>
            onChange({
              type: "inputs",
              values: { ...values, [field.name]: next },
            })
          }
        />
      ))}
    </div>
  );
}
