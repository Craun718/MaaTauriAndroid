import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { EVENTS, Joyride, STATUS, type Step } from "react-joyride";
import { useLocation, useNavigate } from "react-router-dom";
import { getRunStatus } from "../lib/api";
import { GUIDE_STEPS, guideSelector, shouldShowGuide } from "../lib/guide";
import { useTranslation } from "../lib/i18n";
import { useAppStore } from "../store/appStore";
import { useGuideStore } from "../store/guideStore";
import { useNotificationStore } from "../store/notificationStore";
import { usePreparationStore } from "../store/preparationStore";
import { GuideTooltip } from "./GuideTooltip";

export function GuideHost(): ReactElement | null {
  const snapshot = useAppStore((state) => state.snapshot);
  const bootstrapStatus = useAppStore((state) => state.bootstrapStatus);
  const busy = useAppStore((state) => state.busy);
  const preparation = usePreparationStore((state) => state.state);
  const active = useGuideStore((state) => state.active);
  const dismissed = useGuideStore((state) => state.dismissed);
  const start = useGuideStore((state) => state.start);
  const cancel = useGuideStore((state) => state.cancel);
  const ready = Boolean(
    snapshot?.project &&
      bootstrapStatus === "ready" &&
      !busy &&
      (preparation?.status === "idle" || preparation?.status === "ready"),
  );

  useEffect(() => {
    if (!ready) {
      if (active) cancel();
      return;
    }
    if (!active && !dismissed && shouldShowGuide(snapshot?.configuration))
      start();
  }, [active, cancel, dismissed, ready, snapshot?.configuration, start]);

  return active && ready ? <GuideSession /> : null;
}

interface GuideGeometry {
  rem: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

/** A before hook must wait for React's route commit, including Suspense. */
function waitForGuideTarget(
  selector: string,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    function visible(): boolean {
      const element = document.querySelector(selector);
      return Boolean(element?.getClientRects().length);
    }
    if (signal.aborted || visible()) {
      resolve();
      return;
    }
    function finish(): void {
      observer.disconnect();
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    const observer = new MutationObserver(() => {
      if (visible()) finish();
    });
    // An optional/missing target is left to Joyride's normal skip behavior.
    const timeout = window.setTimeout(finish, 4000);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    signal.addEventListener("abort", finish, { once: true });
  });
}

function GuideSession(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const navigation = useRef(navigate);
  navigation.current = navigate;
  const { pathname } = useLocation();
  const returnPath = useRef(pathname);
  const displayed = useRef(false);
  const targetWait = useRef<AbortController | undefined>(undefined);
  const probe = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<GuideGeometry>();
  const [idle, setIdle] = useState(false);
  const cancel = useGuideStore((state) => state.cancel);
  const finish = useGuideStore((state) => state.finish);
  const setTarget = useGuideStore((state) => state.setTarget);

  useEffect(() => {
    const controller = new AbortController();
    targetWait.current = controller;
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let disposed = false;
    // A replay must not move the user away from an ongoing run.
    void getRunStatus()
      .then((result) => {
        if (disposed) return;
        if (result.state === "Idle") setIdle(true);
        else {
          cancel();
          useNotificationStore
            .getState()
            .notify(t("guideRunActive"), { tone: "warning" });
        }
      })
      .catch(() => {
        if (disposed) return;
        cancel();
        useNotificationStore
          .getState()
          .notify(t("guideUnavailable"), { tone: "warning" });
      });
    return () => {
      disposed = true;
    };
  }, [cancel, t]);

  useEffect(() => {
    const element = probe.current;
    if (!element) return;
    function measure(): void {
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const rem = Number.parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      setGeometry({
        rem,
        padding: {
          top: rect.top + rem,
          right: window.innerWidth - rect.right + rem,
          bottom: window.innerHeight - rect.bottom + rem,
          left: rect.left + rem,
        },
      });
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const steps = useMemo<Step[]>(
    () =>
      GUIDE_STEPS.map((definition) => ({
        target: guideSelector(definition.target),
        title: t(definition.titleKey),
        content: t(definition.bodyKey),
        placement: "bottom",
        before: async () => {
          setTarget(definition.target);
          navigation.current(definition.route, { replace: true });
          if (targetWait.current) {
            await waitForGuideTarget(
              guideSelector(definition.target),
              targetWait.current.signal,
            );
          }
        },
      })),
    [setTarget, t],
  );

  return (
    <>
      {/* Resolve the existing CSS safe-area variables for Floating UI's numeric API. */}
      <div
        ref={probe}
        aria-hidden="true"
        className="pointer-events-none invisible fixed inset-x-0 top-[var(--tt-safe-top)] bottom-[var(--tt-safe-bottom)] mx-auto max-w-md"
      />
      {idle && geometry && (
        <Joyride
          continuous
          run
          steps={steps}
          scrollToFirstStep
          tooltipComponent={GuideTooltip}
          loaderComponent={null}
          locale={{
            back: t("guideBack"),
            close: t("guideSkip"),
            last: t("guideDone"),
            next: t("guideNext"),
            skip: t("guideSkip"),
          }}
          options={{
            skipBeacon: true,
            blockTargetInteraction: true,
            overlayClickAction: false,
            dismissKeyAction: false,
            closeButtonAction: "skip",
            buttons: ["back", "primary", "skip"],
            spotlightPadding: geometry.rem * 0.25,
            spotlightRadius: geometry.rem * 0.5,
            scrollOffset: geometry.rem,
            offset: geometry.rem * 0.5,
            targetWaitTimeout: 5000,
            backgroundColor: "var(--tt-raised)",
            textColor: "var(--tt-ink)",
            primaryColor: "var(--tt-accent)",
            zIndex: 70,
          }}
          floatingOptions={{
            hideArrow: true,
            strategy: "fixed",
            flipOptions: { padding: geometry.padding },
            shiftOptions: { padding: geometry.padding, crossAxis: true },
          }}
          onEvent={(data) => {
            if (data.type === EVENTS.TOOLTIP) displayed.current = true;
            if (data.type === EVENTS.ERROR) {
              cancel();
              useNotificationStore
                .getState()
                .notify(t("guideUnavailable"), { tone: "warning" });
            }
            if (data.type !== EVENTS.TOUR_END) return;
            if (
              data.status === STATUS.SKIPPED ||
              (data.status === STATUS.FINISHED && displayed.current)
            ) {
              finish();
            } else {
              cancel();
              useNotificationStore
                .getState()
                .notify(t("guideUnavailable"), { tone: "warning" });
            }
            navigate(returnPath.current, { replace: true });
          }}
        />
      )}
    </>
  );
}
