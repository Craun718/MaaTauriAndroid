import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "../lib/i18n";
import type { ProjectMetadata } from "../lib/types";
import { RichDescription } from "./RichDescription";
import { Modal } from "./ui/Modal";

/** Which about entry the modal shows. */
type AboutTopic = "contact" | "license";

/** Shared look of the about card's entry rows. */
const rowClass =
  "flex h-9 w-full cursor-pointer items-center justify-between rounded-md border border-line px-2.5 text-sm font-semibold";

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
          <button
            key={row.topic}
            type="button"
            onClick={() => setTopic(row.topic)}
            className={rowClass}
          >
            {row.label}
            <ChevronRight size="1rem" className="text-ink-muted" />
          </button>
        ))}
      {metadata.github && (
        <button type="button" onClick={openRepository} className={rowClass}>
          {t("aboutRepository")}
          <ChevronRight size="1rem" className="text-ink-muted" />
        </button>
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
