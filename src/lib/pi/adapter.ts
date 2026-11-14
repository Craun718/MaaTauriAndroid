import type {
  ConfigurationTemplate,
  ControllerDefinition,
  GroupDefinition,
  InputFieldDefinition,
  OptionApplicability,
  OptionCase,
  OptionDefinition,
  PretaskDefinition,
  Project,
  ProjectMetadata,
  ResourceDefinition,
  SettingSection,
  TaskDefinition,
  TelemetryConfig,
  TemplatePretask,
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
  if (!item || !name) {
    throw new Error("could not parse input definition: name is required");
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
  if (
    inputType !== "text" &&
    inputType !== "file" &&
    inputType !== "directory" &&
    inputType !== "time"
  ) {
    throw new Error(`unknown input type: ${inputType}`);
  }
  return {
    name,
    label: localize(item.label) ?? name,
    description: localize(item.description),
    placeholder: localize(item.placeholder),
    default: optionalString(item.default),
    pipelineType,
    verify: optionalString(item.verify),
    patternMessage: optionalString(item.pattern_msg),
    password: boolean(item.password) ?? false,
    inputType,
  };
}

function parseHotkeyField(
  value: RawJsonValue,
  localize: (value: unknown) => string | undefined,
) {
  const item = object(value);
  const name = optionalString(item?.name);
  if (!item || !name) {
    throw new Error("could not parse hotkey definition: name is required");
  }
  return {
    name,
    label: localize(item.label) ?? name,
    default: optionalString(item?.default),
  };
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
      hotkeys: array(item.hotkeys).map((field) =>
        parseHotkeyField(field, localize),
      ),
      applicability: scope,
    };
  }
  throw new Error(`unsupported option type: ${kind}`);
}

function parseTemplateTask(
  value: RawJsonValue,
  localize: (value: unknown) => string | undefined,
  definitions: Record<string, OptionDefinition>,
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
  for (const [name, value] of Object.entries(option)) {
    const definition = definitions[name];
    if (definition?.kind === "input" && value.type === "inputs") {
      for (const field of definition.inputs) {
        if (field.password) delete value.values[field.name];
      }
    }
  }
  return {
    taskName,
    enabled: boolean(item.enabled) ?? true,
    option,
    label: localize(item.label) ?? taskName,
  };
}

function parseTemplatePretasks(
  value: RawJsonValue | undefined,
  pretasks: PretaskDefinition[],
  options: Record<string, OptionDefinition>,
): TemplatePretask[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("preset pretask must be an array");
  const result: TemplatePretask[] = [];
  for (const raw of value) {
    const item = object(raw);
    const name = optionalString(item?.name);
    if (!item || !name) throw new Error("preset pretask name is required");
    if (!pretasks.some((task) => task.explicitName === name)) continue;
    if (item.enabled !== undefined && typeof item.enabled !== "boolean") {
      throw new Error("preset pretask enabled must be boolean");
    }
    const parsed = parseTemplateTask(raw, () => undefined, options);
    if (parsed)
      result.push({ name, enabled: parsed.enabled, option: parsed.option });
  }
  return result;
}

function welcomeDeclarations(
  value: unknown,
  translations: Record<string, string>,
): [string[], string[]] {
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
  const declarations = rawValues
    .filter((item) => item.trim() !== "")
    .map(
      (declaration) =>
        localize(declaration, translations) ?? declaration.replace(/^\$/, ""),
    );
  return [declarations, errors.sort()];
}

function textFilePath(value: string): string | undefined {
  return isFilePath(value) ? value.replace(/^\.\//, "") : undefined;
}

async function parseWelcome(
  value: unknown,
  translations: Record<string, string>,
  readFile: ProjectTextReader,
): Promise<[string[], string[]]> {
  const [declarations, errors] = welcomeDeclarations(value, translations);
  const welcome: string[] = [];
  for (const declaration of declarations) {
    const relative = textFilePath(declaration);
    if (relative !== undefined) {
      try {
        welcome.push(await readFile(relative));
      } catch {
        welcome.push(declaration);
      }
    } else {
      welcome.push(declaration);
    }
  }
  return [welcome, errors];
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
  if (resolved === undefined) return resolved;
  const relative = textFilePath(resolved);
  if (relative === undefined) return resolved;
  try {
    return await readFile(relative);
  } catch {
    return resolved;
  }
}

export function metadataTextPaths(
  source: ProjectSource,
  preferredLanguage: string,
): string[] {
  const language = selectLanguage(source, preferredLanguage);
  const translations = source.translations[language] ?? {};
  const [declarations] = welcomeDeclarations(
    source.document.welcome,
    translations,
  );
  const paths = [
    ...declarations
      .map(textFilePath)
      .filter((path): path is string => path !== undefined),
    ...[source.document.contact, source.document.license]
      .map((value) => {
        const resolved = localize(value, translations);
        return resolved === undefined ? undefined : textFilePath(resolved);
      })
      .filter((path): path is string => path !== undefined),
  ];
  return [...new Set(paths)];
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

  const pretaskItems =
    document.pretask === undefined
      ? []
      : Array.isArray(document.pretask)
        ? document.pretask
        : isRawObject(document.pretask)
          ? [document.pretask]
          : undefined;
  if (!pretaskItems) throw new Error("pretask must be an object or array");
  const pretaskNames = new Set<string>();
  for (const value of pretaskItems) {
    const name = optionalString(object(value)?.name);
    if (name !== undefined) {
      if (pretaskNames.has(name))
        throw new Error(`duplicate pretask name: ${name}`);
      pretaskNames.add(name);
    }
  }
  const pretasks: PretaskDefinition[] = pretaskItems.map((value, index) => {
    const item = object(value);
    const exec = optionalString(item?.exec);
    if (!item || !exec?.trim())
      throw new Error("missing required field: pretask.exec");
    const explicitName = optionalString(item.name);
    if (item.name !== undefined && !explicitName?.trim()) {
      throw new Error("pretask name must be a non-empty string");
    }
    let name = explicitName ?? `${exec}#${index}`;
    if (explicitName === undefined) {
      while (pretaskNames.has(name)) name += "#";
      pretaskNames.add(name);
    }
    if (
      item.args !== undefined &&
      (!Array.isArray(item.args) || !item.args.every(isString))
    ) {
      throw new Error(`pretask args for ${name} must be a string array`);
    }
    return {
      name,
      explicitName,
      exec,
      args: strings(item.args),
      label: localizeText(item.label) ?? explicitName ?? exec,
      description: localizeText(item.description),
      icon: localizeText(item.icon),
      options: strings(item.option),
      controllers: strings(item.controller),
      resources: strings(item.resource),
    };
  });

  const optionRecords = object(document.option) ?? {};
  const options: Record<string, OptionDefinition> = {};
  for (const name of Object.keys(optionRecords).sort(compareUtf8)) {
    options[name] = parseOption(name, optionRecords[name], localizeText);
  }
  const globalOptions = strings(document.global_option);
  for (const name of globalOptions) {
    if (!options[name]) throw new Error(`unknown option reference: ${name}`);
  }
  for (const task of [...tasks, ...pretasks]) {
    for (const name of task.options) {
      if (!options[name]) throw new Error(`unknown option reference: ${name}`);
    }
  }

  const presets = array(document.preset).flatMap((value) => {
    const item = object(value);
    const presetName = optionalString(item?.name);
    if (!item || !presetName) return [];
    const controllers = strings(item.controller);
    if (
      controllers.length > 0 &&
      !controllers.includes(androidController(document).name)
    ) {
      return [];
    }
    return [
      {
        name: presetName,
        label: localizeText(item.label) ?? presetName,
        description: localizeText(item.description),
        tasks: array(item.task)
          .map((task) => parseTemplateTask(task, localizeText, options))
          .filter((task): task is TemplateTask => task !== undefined),
        pretasks: parseTemplatePretasks(item.pretask, pretasks, options),
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
    pretasks,
    tasks,
    options,
    globalOptions,
    presets,
    metadata,
  };
}
