import { stripInlineRichText } from "./richText";
import type { UserConfiguration } from "./types";

/** Startup announcements stay on screen this long before they can be
 * dismissed, so a launch does not let the user tap past unread content. */
export const STARTUP_ANNOUNCEMENT_HOLD_MS = 5000;

const atxHeading = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?[ \t]*$/;
const codeFence = /^ {0,3}(?:```|~~~)/;

/**
 * The text of an announcement's first Markdown heading, used as its tab label.
 * Fenced code blocks are skipped so a `# comment` inside a sample is not
 * mistaken for a title, and inline markup is stripped because the label is
 * plain text. Announcements without a heading return undefined; callers fall
 * back to a numbered label.
 */
export function announcementTitle(body: string): string | undefined {
  let fenced = false;
  for (const line of body.split(/\r?\n/)) {
    if (codeFence.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = atxHeading.exec(line)?.[1]?.replace(/[ \t]+#+$/, "");
    const title = stripInlineRichText(heading ?? "");
    if (title) return title;
  }
  return undefined;
}

interface AnnouncementIdentity {
  fingerprint?: string;
  appVersion?: string;
}

interface AnnouncementAcknowledgement extends AnnouncementIdentity {
  welcomeFingerprint?: string;
  welcomeAcknowledgedAppVersion?: string;
}

interface AnnouncementPreference {
  skipWelcomeAnnouncement?: boolean;
}

interface AnnouncementVisibilityState
  extends AnnouncementAcknowledgement,
    AnnouncementPreference {
  hasContent: boolean;
}

/** A welcome is acknowledged only for the same content and installed app version. */
export function isAnnouncementAcknowledged({
  fingerprint,
  appVersion,
  welcomeFingerprint,
  welcomeAcknowledgedAppVersion,
}: AnnouncementAcknowledgement): boolean {
  return (
    welcomeFingerprint === fingerprint &&
    welcomeAcknowledgedAppVersion === appVersion
  );
}

/** A changed welcome or app install must reappear, even if previously skipped. */
export function shouldShowAnnouncement(
  visibility: AnnouncementVisibilityState,
): boolean {
  return (
    visibility.hasContent &&
    (!visibility.skipWelcomeAnnouncement ||
      !isAnnouncementAcknowledged(visibility))
  );
}

export function acknowledgeAnnouncement(
  configuration: UserConfiguration,
  { fingerprint, appVersion }: AnnouncementIdentity,
  skipNextLaunch: boolean,
): UserConfiguration {
  return {
    ...configuration,
    welcomeFingerprint: fingerprint,
    welcomeAcknowledgedAppVersion: appVersion,
    skipWelcomeAnnouncement: skipNextLaunch,
  };
}

/**
 * The "don't show again" checkbox mirrors the user's in-session choice; the
 * persisted preference only seeds it. Acknowledgement must not gate it: the
 * modal auto-opens precisely while nothing is acknowledged yet (first launch
 * after install), and a gated checkbox would be inert exactly there.
 */
export function resolveAnnouncementRemember(
  selection: boolean | undefined,
  { skipWelcomeAnnouncement }: AnnouncementPreference,
): boolean {
  return selection ?? Boolean(skipWelcomeAnnouncement);
}
