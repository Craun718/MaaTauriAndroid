export type RawJsonValue =
  | string
  | number
  | boolean
  | null
  | RawJsonValue[]
  | { [key: string]: RawJsonValue };

export type RawJsonObject = { [key: string]: RawJsonValue };

export interface RawProjectInterface extends RawJsonObject {
  interface_version?: RawJsonValue;
  name?: RawJsonValue;
  label?: RawJsonValue;
  title?: RawJsonValue;
  version?: RawJsonValue;
  icon?: RawJsonValue;
  github?: RawJsonValue;
  contact?: RawJsonValue;
  license?: RawJsonValue;
  welcome?: RawJsonValue;
  languages?: RawJsonValue;
  import?: RawJsonValue;
  controller?: RawJsonValue;
  resource?: RawJsonValue;
  group?: RawJsonValue;
  setting?: RawJsonValue;
  task?: RawJsonValue;
  option?: RawJsonValue;
  global_option?: RawJsonValue;
  preset?: RawJsonValue;
  agent?: RawJsonValue;
  telemetry?: RawJsonValue;
}

export interface RawImportFragment extends RawJsonObject {
  import?: RawJsonValue;
  controller?: RawJsonValue;
  resource?: RawJsonValue;
  group?: RawJsonValue;
  setting?: RawJsonValue;
  task?: RawJsonValue;
  option?: RawJsonValue;
  global_option?: RawJsonValue;
  preset?: RawJsonValue;
  agent?: RawJsonValue;
  pretask?: RawJsonValue;
}

export type ProjectTextReader = (relativePath: string) => Promise<string>;

export interface ProjectSource {
  root: string;
  document: RawProjectInterface;
  translations: Record<string, Record<string, string>>;
}
