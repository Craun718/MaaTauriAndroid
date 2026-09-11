import { OptionEditor } from "../components/OptionEditor";
import { activeResource, defaultOptionValue } from "../lib/options";
import { useAppStore } from "../store/appStore";
import type { UserConfiguration } from "../lib/types";

export function SetupPage() {
  const snapshot = useAppStore((state) => state.snapshot);
  const saveConfiguration = useAppStore((state) => state.saveConfiguration);
  if (!snapshot?.project) return <EmptyProject />;
  const { project, configuration } = snapshot;
  const resource = activeResource(project, configuration);

  function update(mutate: (configuration: UserConfiguration) => UserConfiguration) {
    void saveConfiguration(mutate(structuredClone(configuration)));
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Setup</h1>
      <section className="space-y-3">
        <h2 className="font-medium">Controller</h2>
        {project.controllers.map((controller) => (
          <button
            key={controller.name}
            type="button"
            onClick={() =>
              update((current) => ({ ...current, activeController: controller.name }))
            }
            className={`flex min-h-14 w-full items-center justify-between rounded-lg border p-3 text-left ${
              configuration.activeController === controller.name
                ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,var(--surface-raised))]"
                : "border-[var(--border)] bg-[var(--surface-raised)]"
            }`}
          >
            <span className="font-medium">{controller.label}</span>
            <span className="text-sm text-[var(--text-muted)]">{controller.controllerType}</span>
          </button>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="font-medium">Resource</h2>
        <div className="flex min-h-14 w-full flex-col rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-left">
          <span className="font-medium">{resource?.label ?? "Unavailable"}</span>
          <span className="text-sm text-[var(--text-muted)]">
            {resource?.paths.join(", ") ?? "No resources are declared."}
          </span>
        </div>
      </section>
      <ScopedOptions
        title="Global"
        names={project.globalOptions}
        values={configuration.globalOptionValues}
        onChange={(name, value) =>
          update((current) => ({
            ...current,
            globalOptionValues: { ...current.globalOptionValues, [name]: value },
          }))
        }
      />
      <ScopedOptions
        title="Resource options"
        names={resource?.options ?? []}
        values={configuration.resourceOptionValues[resource?.name ?? ""] ?? {}}
        onChange={(name, value) =>
          update((current) => ({
            ...current,
            resourceOptionValues: {
              ...current.resourceOptionValues,
              [resource?.name ?? ""]: {
                ...(current.resourceOptionValues[resource?.name ?? ""] ?? {}),
                [name]: value,
              },
            },
          }))
        }
      />
    </div>
  );
}

function ScopedOptions({
  title,
  names,
  values,
  onChange,
}: {
  title: string;
  names: string[];
  values: Record<string, import("../lib/types").OptionValue>;
  onChange: (name: string, value: import("../lib/types").OptionValue) => void;
}) {
  const project = useAppStore((state) => state.snapshot?.project);
  if (names.length === 0) return null;
  return (
    <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <h2 className="font-medium">{title}</h2>
      {names.map((name) => {
        const option = project?.options[name];
        if (!option) return null;
        return (
          <OptionEditor
            key={name}
            option={option}
            value={defaultOptionValue(option, values[name])}
            onChange={(value) => onChange(name, value)}
          />
        );
      })}
    </section>
  );
}

export function EmptyProject() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Project</h1>
      <p className="mt-2 text-[var(--text-muted)]">Load a project from Settings.</p>
    </div>
  );
}
