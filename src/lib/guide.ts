import type { MessageKey } from "./i18n";
import type { UserConfiguration } from "./types";

export const GUIDE_VERSION = 1;

export type GuideRoute = "/" | "/tasks" | "/runs" | "/settings";
export type GuideTargetName =
  | "home-privilege"
  | "home-summary"
  | "tasks-resource"
  | "tasks-configurations"
  | "tasks-run"
  | "tasks-activities"
  | "runs-history"
  | "settings-about";

export interface GuideStepDefinition {
  route: GuideRoute;
  target: GuideTargetName;
  titleKey: MessageKey;
  bodyKey: MessageKey;
}

export const GUIDE_STEPS: readonly GuideStepDefinition[] = [
  {
    route: "/",
    target: "home-summary",
    titleKey: "guideSummaryTitle",
    bodyKey: "guideSummaryBody",
  },
  {
    route: "/",
    target: "home-privilege",
    titleKey: "guidePrivilegeTitle",
    bodyKey: "guidePrivilegeBody",
  },
  {
    route: "/tasks",
    target: "tasks-resource",
    titleKey: "guideResourceTitle",
    bodyKey: "guideResourceBody",
  },
  {
    route: "/tasks",
    target: "tasks-configurations",
    titleKey: "guideConfigurationTitle",
    bodyKey: "guideConfigurationBody",
  },
  {
    route: "/tasks",
    target: "tasks-run",
    titleKey: "guideRunTitle",
    bodyKey: "guideRunBody",
  },
  {
    route: "/tasks",
    target: "tasks-activities",
    titleKey: "guideActivitiesTitle",
    bodyKey: "guideActivitiesBody",
  },
  {
    route: "/runs",
    target: "runs-history",
    titleKey: "guideHistoryTitle",
    bodyKey: "guideHistoryBody",
  },
  {
    route: "/settings",
    target: "settings-about",
    titleKey: "guideSettingsTitle",
    bodyKey: "guideSettingsBody",
  },
] as const;

export function guideSelector(target: GuideTargetName): string {
  return `[data-guide-target='${target}']`;
}

export function shouldShowGuide(
  configuration: Pick<UserConfiguration, "guideSeenVersion"> | undefined,
): boolean {
  return (
    configuration !== undefined &&
    (configuration.guideSeenVersion ?? 0) < GUIDE_VERSION
  );
}

export function markGuideSeen(
  configuration: UserConfiguration,
): UserConfiguration {
  return shouldShowGuide(configuration)
    ? { ...configuration, guideSeenVersion: GUIDE_VERSION }
    : configuration;
}

export function shouldDeferAnnouncement(
  configuration: Pick<UserConfiguration, "guideSeenVersion">,
  active: boolean,
  dismissed: boolean,
): boolean {
  return active || (!dismissed && shouldShowGuide(configuration));
}
