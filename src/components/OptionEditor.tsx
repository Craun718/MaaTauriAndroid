import type { OptionDefinition, OptionValue } from "../lib/types";

interface OptionEditorProps {
  option: OptionDefinition;
  value?: OptionValue;
  onChange: (value: OptionValue) => void;
}

export function OptionEditor({ option, value, onChange }: OptionEditorProps) {
  if (option.kind === "select" || option.kind === "switch") {
    const selected = value?.type === "single" ? value.case : option.defaultCase;
    return (
      <div className="space-y-3">
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium">{option.label}</p>
            {option.description && (
              <p className="text-sm text-[var(--text-muted)]">{option.description}</p>
            )}
          </div>
        </div>
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${Math.min(option.cases.length, 3)}, minmax(0, 1fr))` }}
        >
          {option.cases.map((item) => (
            <button
              key={item.name}
              type="button"
              onClick={() => onChange({ type: "single", case: item.name })}
              className={`h-10 rounded-md border px-3 text-sm font-medium transition ${
                selected === item.name
                  ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]"
                  : "border-[var(--border)] bg-[var(--surface-raised)]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
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
              <label
                key={item.name}
                className="flex min-h-11 items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--accent)]"
                  checked={checked}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...selected, item.name]
                      : selected.filter((name) => name !== item.name);
                    onChange({ type: "multiple", cases: next });
                  }}
                />
                <span>{item.label}</span>
              </label>
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
        <label key={field.name} className="block">
          <span className="mb-1 block text-sm text-[var(--text-muted)]">{field.label}</span>
          <input
            type={option.kind === "input" && field.password ? "password" : "text"}
            value={values[field.name] ?? field.default ?? ""}
            onChange={(event) =>
              onChange({
                type: "inputs",
                values: { ...values, [field.name]: event.target.value },
              })
            }
            className="h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3"
          />
        </label>
      ))}
    </div>
  );
}
