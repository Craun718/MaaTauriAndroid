import type {
  ConfigurationTemplate,
  ControllerDefinition,
  GroupDefinition,
  InputFieldDefinition,
  OptionApplicability,
  OptionCase,
  OptionDefinition,
  Project,
  ProjectMetadata,
  ResourceDefinition,
  SettingSection,
  TaskDefinition,
  TelemetryConfig,
  TemplateTask,
} from "../types";
import { compareUtf8, isRawObject } from "./loader";
import type {
  ProjectSource,
  ProjectTextReader,
  RawJsonObject,
  RawJsonValue,
} from "./rawTypes";

const ANDROID_CONTROLLER = "Android";

function object(value: unknown): RawJsonObject | undefined {
  return isRawObject(value) ? value : undefined;
}

function array(value: unknown): RawJsonValue[] {
  return Array.isArray(value) ? value : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function strings(value: unknown): string[] {
  return array(value).filter(isString);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function localize(
  value: unknown,
  translations: Record<string, string>,
): string | undefined {
  const text = optionalString(value);
  if (text === undefined) return undefined;
  if (text.startsWith("$")) return translations[text.slice(1)];
  return text;
}

function text(value: unknown, translations: Record<string, string>) {
  const localize = (value: unknown): string | undefined => {
    const text = optionalString(value);
    if (text === undefined) return undefined;
    if (text.startsWith("$")) return translations[text.slice(1)];
    return text;
  };
  return localize(value);
}

function selectLanguage(
  source: ProjectSource,
  preferredLanguage: string,
): string {
  const languages = source.languages;
  if (languages.includes(preferredLanguage)) return preferredLanguage;
  return (
    languages.find((language) => language === "zh_cn") ??
    languages[0] ??
    "zh_cn"
  );
}

function androidController(document: RawJsonObject): ControllerDefinition {
  const declared = array(document.controller).find((item) => {
    const type = object(item)?.type;
    return typeof type === "string" && type.toLowerCase() === "adb";
  });
  const name =
    (declared ? optionalString(object(declared)?.name) : undefined) ??
    ANDROID_CONTROLLER;
  return {
    name,
    label: ANDROID_CONTROLLER,
    controllerType: "AndroidNative",
  };
}

function applicability(item: RawJsonObject): OptionApplicability {
  return {
    controllers: strings(item.controller),
    resources: strings(item.resource),
  };
}

function optionCases(
  item: RawJsonObject,
  localize: (value: unknown) => string | undefined,
): OptionCase[] {
  return array(item.cases).map((value) => {
    const item = object(value) ?? {};
    const name = optionalString(item.name) ?? "";
    return {
      name,
      label: localize(item.label) ?? name,
      description: localize(item.description),
      options: strings(item.option),
    };
  });
}

function defaultCase(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return optionalString(value[0]);
  return undefined;
}

function parseInputField(
  value: RawJsonValue,
  localize: (value: unknown) => string | undefined,
): InputFieldDefinition {
  const item = object(value);
  const name = optionalString(item?.name);
  const label = optionalString(item?.label);
  if (!item || !name || !label) {
    throw new Error(
      "could not parse input definition: name and label are required",
    );
  }
  const pipelineType = optionalString(item.pipeline_type) ?? "string";
  const inputType = optionalString(item.input_type) ?? "text";
  if (
    pipelineType !== "string" &&
    pipelineType !== "int" &&
    pipelineType !== "bool"
  ) {
    throw new Error(`unknown pipeline type: ${pipelineType}`);
  }
  if (inputType !== "text" && inputType !== "file" && inputType !== "time") {
    throw new Error(`unknown input type: ${inputType}`);
  }
  return {
    name,
    label,
    description: optionalString(item.description),
    placeholder: localize(item.placeholder),
    default: optionalString(item.default),
    pipelineType,
    verify: optionalString(item.verify),
    patternMessage: optionalString(item.pattern_msg),
    password: boolean(item.password) ?? false,
    inputType,
  };
}

function parseHotkeyField(value: RawJsonValue) {
  const item = object(value);
  const name = optionalString(item?.name);
  const label = optionalString(item?.label);
  if (!name || !label) {
    throw new Error(
      "could not parse hotkey definition: name and label are required",
    );
  }
  return { name, label, default: optionalString(item?.default) };
}

function parseOption(
  name: string,
  value: RawJsonValue,
  localize: (value: unknown) => string | undefined,
): OptionDefinition {
  const item = object(value);
  if (!item) throw new Error(`option ${name} must be an object`);
  const label = localize(item.label) ?? name;
  const description = localize(item.description);
  const scope = applicability(item);
  const cases = optionCases(item, localize);
  const kind = (optionalString(item.type) ?? "select").toLowerCase();

  if (kind === "select" || kind === "switch") {
    return {
      kind,
      name,
      label,
      description,
      cases,
      defaultCase: defaultCase(item.default_case),
      applicability: scope,
    };
  }
  if (kind === "checkbox") {
    const defaults = item.default_case;
    return {
      kind,
      name,
      label,
      description,
      cases,
      defaultCases: Array.isArray(defaults)
        ? strings(defaults)
        : optionalString(defaults)
          ? [defaults as string]
          : [],
      minCount: number(item.min_count),
      maxCount: number(item.max_count),
      applicability: scope,
    };
  }
  if (kind === "input") {
    return {
      kind,
      name,
      label,
      description,
      inputs: array(item.inputs).map((field) =>
        parseInputField(field, localize),
      ),
      applicability: scope,
    };
  }
  if (kind === "hotkey") {
    return {
      kind,
      name,
      label,
      description,
      hotkeys: array(item.hotkeys).map(parseHotkeyField),
      applicability: scope,
    };
  }
  throw new Error(`unsupported option type: ${kind}`);
}

function parseTemplateTask(
  value: RawJsonValue,
  localize: (value: unknown) => string | undefined,
): TemplateTask | undefined {
  const item = object(value);
  const taskName = optionalString(item?.name);
  if (!item || !taskName) return undefined;
  const option: Record<
    string,
    ConfigurationTemplate["tasks"][number]["option"][string]
  > = {};
  const values = object(item.option) ?? {};
  for (const name of Object.keys(values)) {
    const value = values[name];
    if (typeof value === "string")
      option[name] = { type: "single", case: value };
    else if (Array.isArray(value)) {
      option[name] = { type: "multiple", cases: strings(value) };
    } else if (isRawObject(value)) {
      const inputValues: Record<string, string> = {};
      for (const key of Object.keys(value)) {
        const input = value[key];
        if (typeof input === "string") inputValues[key] = input;
      }
      option[name] = { type: "inputs", values: inputValues };
    }
  }
  return {
    taskName,
    enabled: boolean(item.enabled) ?? true,
    option,
    label: localize(item.label) ?? taskName,
  };
}

async function parseWelcome(
  value: unknown,
  translations: Record<string, string>,
  readFile: ProjectTextReader,
): Promise<[string[], string[]]> {
  const rawValues: string[] = [];
  const errors: string[] = [];
  if (typeof value === "string") rawValues.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") rawValues.push(item);
      else
        errors.push(`welcome entry is not a string: ${JSON.stringify(item)}`);
    }
  } else if (value !== undefined) {
    errors.push(`welcome is not a string or array: ${JSON.stringify(value)}`);
  }
  const declarations = rawValues.filter((item) => item.trim() !== "");
  const welcome: string[] = [];
  for (const declaration of declarations) {
    const value =
      localize(declaration, translations) ?? declaration.replace(/^\$/, "");
    if (isFilePath(value)) {
      const relative = value.replace(/^\.\//, "");
      try {
        welcome.push(await readFile(relative));
      } catch {
        welcome.push(value);
      }
    } else {
      welcome.push(value);
    }
  }
  return [welcome, errors.sort()];
}

function isFilePath(content: string): boolean {
  if (content.startsWith("https://") || content.startsWith("http://")) {
    return false;
  }
  if (content.startsWith("./") || content.startsWith("../")) return true;
  const simpleName =
    content.length > 0 &&
    content.length <= 100 &&
    [...content].every((char) => /[A-Za-z0-9_./\\-]/.test(char)) &&
    !/^\d+$/.test(content);
  if (!simpleName) return false;
  const lower = content.toLowerCase();
  if (/\.(md|txt|json|html|htm)$/.test(lower)) return true;
  if (/^[A-Z][A-Z0-9_-]*$/.test(content)) return true;
  return content.includes("/") || content.includes("\\");
}

async function descriptionBody(
  value: unknown,
  translations: Record<string, string>,
  readFile: ProjectTextReader,
): Promise<string | undefined> {
  const resolved = localize(value, translations);
  if (resolved === undefined || !isFilePath(resolved)) return resolved;
  const relative = resolved.replace(/^\.\//, "");
  try {
    return await readFile(relative);
  } catch {
    return resolved;
  }
}

function parseTelemetry(value: unknown): TelemetryConfig | undefined {
  const sentry = object(object(value)?.sentry);
  if (!sentry) return undefined;
  return {
    dsn: optionalString(sentry.dsn),
    tracing: boolean(sentry.tracing) ?? true,
    tracesSampleRate: number(sentry.traces_sample_rate) ?? 1,
    failureAttachmentsSampleRate:
      number(sentry.failure_attachments_sample_rate) ?? 1,
    environment: optionalString(sentry.environment),
  };
}

export async function buildAndroidProject(
  source: ProjectSource,
  preferredLanguage: string,
  readFile: ProjectTextReader,
): Promise<Project> {
  const document = source.document;
  const version = number(document.interface_version);
  if (version !== 2) {
    throw new Error(
      `unsupported Project Interface version: ${version ?? "missing"}`,
    );
  }
  const name = optionalString(document.name);
  if (!name) throw new Error("missing required field: name");
  const language = selectLanguage(source, preferredLanguage);
  const translations = source.translations[language] ?? {};
  const localizeText = (value: unknown) => text(value, translations);

  const resources: ResourceDefinition[] = array(document.resource).map(
    (value) => {
      const item = object(value);
      const resourceName = optionalString(item?.name);
      const paths = item ? strings(item.path) : undefined;
      if (!item || !resourceName || !Array.isArray(item.path)) {
        throw new Error(
          "missing required field: resource.name or resource.path",
        );
      }
      return {
        name: resourceName,
        label: localizeText(item.label) ?? resourceName,
        description: localizeText(item.description),
        paths: paths ?? [],
        controllers: strings(item.controller),
        options: strings(item.option),
        hash: optionalString(item.hash),
      };
    },
  );

  const groups: GroupDefinition[] = array(document.group).flatMap((value) => {
    const item = object(value);
    const groupName = optionalString(item?.name);
    if (!item || !groupName) return [];
    return [
      {
        name: groupName,
        label: localizeText(item.label) ?? groupName,
        description: localizeText(item.description),
        defaultExpand: boolean(item.default_expand) ?? true,
      },
    ];
  });

  const settingSections: SettingSection[] = array(document.setting).flatMap(
    (value) => {
      const item = object(value);
      const sectionName = optionalString(item?.name);
      if (!item || !sectionName) return [];
      return [
        {
          name: sectionName,
          label: localizeText(item.label) ?? sectionName,
          description: localizeText(item.description),
          icon: localizeText(item.icon),
          defaultExpand: boolean(item.default_expand) ?? true,
          options: strings(item.option),
        },
      ];
    },
  );

  const tasks: TaskDefinition[] = [];
  for (const value of array(document.task)) {
    const item = object(value);
    const taskName = optionalString(item?.name);
    if (!item || !taskName)
      throw new Error("missing required field: task.name");
    if (tasks.some((task) => task.name === taskName)) {
      throw new Error(`duplicate task name: ${taskName}`);
    }
    tasks.push({
      name: taskName,
      label: localizeText(item.label) ?? taskName,
      description: localizeText(item.description),
      entry: optionalString(item.entry) ?? taskName,
      groups: strings(item.group),
      controllers: strings(item.controller),
      resources: strings(item.resource),
      options: strings(item.option),
      defaultCheck: boolean(item.default_check) ?? false,
    });
  }

  const optionRecords = object(document.option) ?? {};
  const options: Record<string, OptionDefinition> = {};
  for (const name of Object.keys(optionRecords).sort(compareUtf8)) {
    options[name] = parseOption(name, optionRecords[name], localizeText);
  }
  const globalOptions = strings(document.global_option);
  for (const name of globalOptions) {
    if (!options[name]) throw new Error(`unknown option reference: ${name}`);
  }
  for (const task of tasks) {
    for (const name of task.options) {
      if (!options[name]) throw new Error(`unknown option reference: ${name}`);
    }
  }

  const presets = array(document.preset).flatMap((value) => {
    const item = object(value);
    const presetName = optionalString(item?.name);
    if (!item || !presetName) return [];
    return [
      {
        name: presetName,
        label: localizeText(item.label) ?? presetName,
        description: localizeText(item.description),
        tasks: array(item.task)
          .map((task) => parseTemplateTask(task, localizeText))
          .filter((task): task is TemplateTask => task !== undefined),
      },
    ];
  });

  const [welcome, welcomeErrors] = await parseWelcome(
    document.welcome,
    translations,
    readFile,
  );
  const metadata: ProjectMetadata = {
    title: localizeText(document.title),
    github: optionalString(document.github),
    contact: await descriptionBody(document.contact, translations, readFile),
    license: await descriptionBody(document.license, translations, readFile),
    welcome,
    // Remote welcome bodies are resolved and fingerprinted by Rust. A URL is
    // not a body, so the WebView parser intentionally leaves this unset.
    welcomeFingerprint: undefined,
    welcomeErrors,
    telemetry: parseTelemetry(document.telemetry),
  };

  return {
    root: source.root,
    interfaceVersion: 2,
    name,
    label: localizeText(document.label) ?? name,
    version: optionalString(document.version),
    language,
    languages: [...source.languages].sort(compareUtf8),
    controllers: [androidController(document)],
    resources,
    groups,
    settingSections,
    tasks,
    options,
    globalOptions,
    presets,
    metadata,
  };
}
