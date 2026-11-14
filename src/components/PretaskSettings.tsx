import type { ReactElement } from "react";
import { useTranslation } from "../lib/i18n";
import { availablePretasks, pretaskVisibleOptions } from "../lib/pretasks";
import type {
  ConfiguredPretask,
  Project,
  UserConfiguration,
} from "../lib/types";
import { OptionEditor } from "./OptionEditor";
import { ProjectImage } from "./ProjectImage";
import { InlineMarkdownLabel, RichDescription } from "./RichDescription";
import { Checkbox } from "./ui/Checkbox";

export function PretaskSettings({
  project,
  configuration,
  onChange,
}: {
  project: Project;
  configuration: UserConfiguration;
  onChange: (configuration: UserConfiguration) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const tasks = availablePretasks(project, configuration);
  if (tasks.length === 0) return null;
  function update(name: string, value: ConfiguredPretask): void {
    onChange({
      ...configuration,
      pretaskValues: { ...configuration.pretaskValues, [name]: value },
    });
  }
  return (
    <section className="space-y-3 rounded-lg border border-line bg-raised p-card">
      <h2 className="font-semibold">{t("pretasks")}</h2>
      {tasks.map((task) => {
        const value = configuration.pretaskValues[task.name] ?? {
          enabled: true,
          optionValues: {},
        };
        const options = pretaskVisibleOptions(project, configuration, task);
        return (
          <div key={task.name} className="space-y-2 border-t border-line pt-3">
            <Checkbox
              checked={value.enabled}
              onCheckedChange={(enabled) =>
                update(task.name, { ...value, enabled })
              }
            >
              <span className="flex items-center gap-2">
                <ProjectImage
                  path={task.icon}
                  className="h-5 w-5 object-contain"
                />
                <InlineMarkdownLabel text={task.label} />
              </span>
            </Checkbox>
            <RichDescription text={task.description} />
            {value.enabled &&
              options.map(({ name, depth }) => (
                <div
                  key={name}
                  className={depth > 0 ? "ml-3 border-l border-line pl-3" : ""}
                >
                  <OptionEditor
                    compact
                    option={project.options[name]}
                    value={value.optionValues[name]}
                    onChange={(next) =>
                      update(task.name, {
                        ...value,
                        optionValues: { ...value.optionValues, [name]: next },
                      })
                    }
                  />
                </div>
              ))}
          </div>
        );
      })}
    </section>
  );
}
