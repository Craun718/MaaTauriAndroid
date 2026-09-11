import type { OptionDefinition, OptionValue } from "../lib/types";
import { Checkbox } from "./ui/Checkbox";
import { SegmentGroup } from "./ui/SegmentGroup";
import { TextField } from "./ui/TextField";

interface OptionEditorProps {
  option: OptionDefinition;
  value?: OptionValue;
  onChange: (value: OptionValue) => void;
}

export function OptionEditor({ option, value, onChange }: OptionEditorProps) {
  if (option.kind === "select" || option.kind === "switch") {
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
