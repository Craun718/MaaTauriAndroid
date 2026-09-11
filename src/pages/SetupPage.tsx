import { useId } from "react";
import { OptionEditor } from "../components/OptionEditor";
import { RadioGroup } from "../components/ui/RadioGroup";
import { useTranslation } from "../lib/i18n";
import { activeResource, defaultOptionValue } from "../lib/options";
import { useAppStore } from "../store/appStore";
import type { MessageKey } from "../lib/i18n";
import type { UserConfiguration } from "../lib/types";

export function SetupPage() {
  const snapshot = useAppStore((state) => state.snapshot);
  const saveConfiguration = useAppStore((state) => state.saveConfiguration);
  const { t } = useTranslation();
  const controllerLabelId = useId();
  if (!snapshot?.project) return <EmptyProject />;
  const { project, configuration } = snapshot;
  const resource = activeResource(project, configuration);

  function update(mutate: (configuration: UserConfiguration) => UserConfiguration) {
    void saveConfiguration(mutate(structuredClone(configuration)));
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">{t("setup")}</h1>
      <section className="space-y-3">
        <h2 className="font-medium" id={controllerLabelId}>
          {t("controller")}
        </h2>
        <RadioGroup
          className="space-y-3"
          labelledBy={controllerLabelId}
          value={configuration.activeController}
          onValueChange={(name) =>
            update((current) => ({ ...current, activeController: name }))
          }
          items={project.controllers.map((controller) => ({
            value: controller.name,
            content: (
              <>
                <span className="font-medium">{controller.label}</span>
                <span className="text-sm text-[var(--text-muted)]">
                  {controller.controllerType}
                </span>
              </>
            ),
          }))}
        />
      </section>
      <section className="space-y-3">
        <h2 className="font-medium">{t("resource")}</h2>
        <div className="flex min-h-14 w-full flex-col rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-left">
          <span className="font-medium">{resource?.label ?? t("unavailable")}</span>
          <span className="text-sm text-[var(--text-muted)]">
            {resource?.paths.join(", ") ?? t("noResources")}
          </span>
        </div>
      </section>
      <ScopedOptions
        title="globalOptions"
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
        title="resourceOptions"
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
  title: MessageKey;
  names: string[];
  values: Record<string, import("../lib/types").OptionValue>;
  onChange: (name: string, value: import("../lib/types").OptionValue) => void;
}) {
  const project = useAppStore((state) => state.snapshot?.project);
  const { t } = useTranslation();
  if (names.length === 0) return null;
  return (
    <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <h2 className="font-medium">{t(title)}</h2>
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
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="text-2xl font-semibold">{t("project")}</h1>
      <p className="mt-2 text-[var(--text-muted)]">{t("loadProjectHint")}</p>
    </div>
  );
}
