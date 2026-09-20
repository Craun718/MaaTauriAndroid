import type { UserConfiguration } from "./types";

interface AnnouncementIdentity {
  fingerprint?: string;
  appVersion?: string;
}

interface AnnouncementAcknowledgement extends AnnouncementIdentity {
  welcomeFingerprint?: string;
  welcomeAcknowledgedAppVersion?: string;
}

interface AnnouncementVisibilityState extends AnnouncementAcknowledgement {
  hasContent: boolean;
  skipWelcomeAnnouncement?: boolean;
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
