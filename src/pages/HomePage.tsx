import { Megaphone } from "lucide-react";
import { useState } from "react";
import { AnnouncementModal } from "../components/AnnouncementModal";
import { PrivilegeStatusCard } from "../components/PrivilegeStatusCard";
import { VersionCard } from "../components/VersionCard";
import {
  acknowledgeAnnouncement,
  isAnnouncementAcknowledged,
  shouldShowAnnouncement,
} from "../lib/announcements";
import { useTranslation } from "../lib/i18n";
import type { Project, UserConfiguration } from "../lib/types";
import { useAppStore } from "../store/appStore";

export function HomePage() {
  const snapshot = useAppStore((state) => state.snapshot);
  const busy = useAppStore((state) => state.busy);
  const saveConfiguration = useAppStore((state) => state.saveConfiguration);
  const { t } = useTranslation();

  if (!snapshot?.project) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">{t("project")}</h1>
        <p className="text-ink-muted">{t("noProject")}</p>
      </div>
    );
  }

  const { project, versions } = snapshot;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          {project.label}
        </h1>
      </header>

      <ProjectAnnouncements
        project={project}
        configuration={snapshot.configuration}
        appVersion={versions?.appVersion}
        onSaveConfiguration={saveConfiguration}
      />

      <VersionCard
        title="versions"
        variant="about"
        project={project}
        versions={versions}
      />

      <PrivilegeStatusCard title="privilegedHost" />

      {busy && <p className="text-sm text-ink-muted">{t("saving")}</p>}
    </div>
  );
}

function ProjectAnnouncements({
  project,
  configuration,
  appVersion,
  onSaveConfiguration,
}: {
  project: Project;
  configuration: UserConfiguration;
  appVersion?: string;
  onSaveConfiguration: (configuration: UserConfiguration) => Promise<void>;
}) {
  const { t } = useTranslation();
  const dismissedWelcomeFingerprint = useAppStore(
    (state) => state.dismissedWelcomeFingerprint,
  );
  const dismissWelcome = useAppStore((state) => state.dismissWelcome);
  const { welcome, welcomeFingerprint } = project.metadata;
  const contentFingerprint = welcomeFingerprint ?? welcome.join("\u0000");
  const [manualFingerprint, setManualFingerprint] = useState<string>();
  const [rememberSelection, setRememberSelection] = useState(
    Boolean(configuration.skipWelcomeAnnouncement),
  );
  const remember = isAnnouncementAcknowledged({
    fingerprint: contentFingerprint,
    appVersion,
    welcomeFingerprint: configuration.welcomeFingerprint,
    welcomeAcknowledgedAppVersion: configuration.welcomeAcknowledgedAppVersion,
  })
    ? rememberSelection
    : false;
  const shouldAutoOpen = shouldShowAnnouncement({
    hasContent: welcome.length > 0,
    fingerprint: contentFingerprint,
    appVersion,
    welcomeFingerprint: configuration.welcomeFingerprint,
    welcomeAcknowledgedAppVersion: configuration.welcomeAcknowledgedAppVersion,
    skipWelcomeAnnouncement: configuration.skipWelcomeAnnouncement,
  });
  const announcementOpen =
    manualFingerprint === contentFingerprint ||
    (shouldAutoOpen && dismissedWelcomeFingerprint !== contentFingerprint);

  function closeAnnouncement() {
    setManualFingerprint(undefined);
    dismissWelcome(contentFingerprint);
  }

  function confirmAnnouncement() {
    closeAnnouncement();
    setRememberSelection(remember);
    void onSaveConfiguration(
      acknowledgeAnnouncement(
        configuration,
        { fingerprint: welcomeFingerprint, appVersion },
        remember,
      ),
    );
  }

  if (welcome.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setManualFingerprint(contentFingerprint)}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-line bg-raised font-medium text-ink"
      >
        <Megaphone size="1rem" />
        {t("openAnnouncement")}
      </button>

      <AnnouncementModal
        open={announcementOpen}
        content={welcome}
        remember={remember}
        onRememberChange={setRememberSelection}
        onClose={closeAnnouncement}
        onConfirm={confirmAnnouncement}
      />
    </>
  );
}
