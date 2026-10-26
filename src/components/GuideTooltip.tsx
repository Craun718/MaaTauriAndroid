import { type ReactElement, useId } from "react";
import type { TooltipRenderProps } from "react-joyride";
import { useTranslation } from "../lib/i18n";

export function GuideTooltip({
  backProps,
  index,
  isLastStep,
  primaryProps,
  skipProps,
  step,
  tooltipProps,
  size,
}: TooltipRenderProps): ReactElement {
  const { t } = useTranslation();
  const id = useId();

  return (
    <section
      {...tooltipProps}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      className="flex max-h-[calc(100dvh_-_var(--tt-safe-top)_-_var(--tt-safe-bottom)_-_2rem)] w-[min(22rem,calc(100vw_-_2rem))] flex-col gap-3 overflow-y-auto rounded-lg border border-base-300 bg-base-100 p-card text-base-content shadow-lg"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id={`${id}-title`} className="font-medium">
          {step.title}
        </h2>
        <span className="shrink-0 text-sm text-ink-muted">
          {t("guideProgress", { current: index + 1, total: size })}
        </span>
      </div>
      <p id={`${id}-body`} className="text-sm text-ink-muted">
        {step.content}
      </p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm mr-auto"
          {...skipProps}
        >
          {t("guideSkip")}
        </button>
        {index > 0 && (
          <button type="button" className="btn btn-sm" {...backProps}>
            {t("guideBack")}
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          {...primaryProps}
        >
          {t(isLastStep ? "guideDone" : "guideNext")}
        </button>
      </div>
    </section>
  );
}
