import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "../lib/i18n";
import type { ProjectMetadata } from "../lib/types";
import { RichDescription } from "./RichDescription";
import { Modal } from "./ui/Modal";

/** Which about entry the modal shows. */
type AboutTopic = "contact" | "license" | "repository";

/**
 * The about card's project entries, following MaaFwApp's about card but
 * presenting each one as a modal instead of a bottom sheet. Contact and
 * license bodies are materialized from project files by the loader; missing
 * entries simply hide their row.
 */
export function AboutLinks({ metadata }: { metadata: ProjectMetadata }) {
  const { t } = useTranslation();
  const [topic, setTopic] = useState<AboutTopic>();

  const rows: Array<{ topic: AboutTopic; label: string; body?: string }> = [
    { topic: "contact", label: t("aboutContact"), body: metadata.contact },
    { topic: "license", label: t("aboutLicense"), body: metadata.license },
    { topic: "repository", label: t("aboutRepository"), body: metadata.github },
  ];
  const active = rows.find((row) => row.topic === topic && row.body);

  return (
    <>
      {rows
        .filter((row) => row.body)
        .map((row) => (
          <button
            key={row.topic}
            type="button"
            onClick={() => setTopic(row.topic)}
            className="flex h-9 w-full cursor-pointer items-center justify-between rounded-md border border-line px-2.5 text-sm font-semibold"
          >
            {row.label}
            <ChevronRight size="1rem" className="text-ink-muted" />
          </button>
        ))}
      <Modal
        open={active !== undefined}
        onClose={() => setTopic(undefined)}
        title={active?.label ?? ""}
      >
        {active?.body && (
          <RichDescription text={modalBody(active.topic, active.body)} />
        )}
      </Modal>
    </>
  );
}

/** The repository body is a bare URL; link it so the shared opener flow
 * handles the tap. Contact/license bodies render as-is. */
function modalBody(topic: AboutTopic, body: string): string {
  return topic === "repository" ? `[${body}](${body})` : body;
}
