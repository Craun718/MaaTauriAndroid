import { openUrl } from "@tauri-apps/plugin-opener";
import { FileText, Github, Mail } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "../lib/i18n";
import type { ProjectMetadata } from "../lib/types";
import { RichDescription } from "./RichDescription";
import { Modal } from "./ui/Modal";
import { SettingAction } from "./ui/SettingRow";

/** Which about entry the modal shows. */
type AboutTopic = "contact" | "license";

/**
 * The about card's project entries, following MaaFwApp's about card.
 * Contact and license open a modal with the loader-materialized bodies;
 * the repository entry jumps straight to the system browser. Missing
 * entries simply hide their row.
 */
export function AboutLinks({ metadata }: { metadata: ProjectMetadata }) {
  const { t } = useTranslation();
  const [topic, setTopic] = useState<AboutTopic>();

  const modalRows: Array<{
    topic: AboutTopic;
    label: string;
    body?: string;
  }> = [
    { topic: "contact", label: t("aboutContact"), body: metadata.contact },
    { topic: "license", label: t("aboutLicense"), body: metadata.license },
  ];
  const active = modalRows.find((row) => row.topic === topic && row.body);

  async function openRepository() {
    const url = metadata.github;
    if (!url) return;
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <>
      {modalRows
        .filter((row) => row.body)
        .map((row) => (
          <SettingAction
            key={row.topic}
            title={row.label}
            icon={
              row.topic === "contact" ? (
                <Mail size="1rem" />
              ) : (
                <FileText size="1rem" />
              )
            }
            onClick={() => setTopic(row.topic)}
          />
        ))}
      {metadata.github && (
        <SettingAction
          title={t("aboutRepository")}
          icon={<Github size="1rem" />}
          external
          onClick={() => void openRepository()}
        />
      )}
      <Modal
        open={active !== undefined}
        onClose={() => setTopic(undefined)}
        title={active?.label ?? ""}
      >
        {active?.body &&
          (active.topic === "license" ? (
            // License files are plain-text legal documents; routing them
            // through Markdown eats the angle brackets and indentation they
            // are full of, so render them verbatim.
            <p className="whitespace-pre-wrap text-sm text-ink-muted">
              {active.body}
            </p>
          ) : (
            <RichDescription text={active.body} />
          ))}
      </Modal>
    </>
  );
}
