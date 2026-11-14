import { type Config, type Driver, type DriveStep, driver } from "driver.js";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "driver.js/dist/driver.css";
import { useLocation, useNavigate } from "react-router-dom";
import { getRunStatus } from "../lib/api";
import { GUIDE_STEPS, guideSelector, shouldShowGuide } from "../lib/guide";
import { useTranslation } from "../lib/i18n";
import { useAppStore } from "../store/appStore";
import { useGuideStore } from "../store/guideStore";
import { useNotificationStore } from "../store/notificationStore";
import { usePreparationStore } from "../store/preparationStore";
import { TaskDemo } from "./TaskDemo";

export function GuideHost(): ReactElement | null {
  const snapshot = useAppStore((state) => state.snapshot);
  const bootstrapStatus = useAppStore((state) => state.bootstrapStatus);
  const busy = useAppStore((state) => state.busy);
  const preparation = usePreparationStore((state) => state.state);
  const active = useGuideStore((state) => state.active);
  const demoActive = useGuideStore((state) => state.demoActive);
  const finish = useGuideStore((state) => state.finish);
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

  return active && ready ? (
    demoActive ? (
      <TaskDemo onDone={finish} />
    ) : (
      <GuideSession />
    )
  ) : null;
}

interface GuideGeometry {
  rem: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

/** A guide transition must wait for React's route commit, including Suspense. */
function waitForGuideTarget(
  selector: string,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    function visible(): boolean {
      const element = document.querySelector(selector);
      return Boolean(element?.getClientRects().length);
    }
    if (visible()) {
      resolve(true);
      return;
    }
    function finish(): void {
      observer.disconnect();
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve(visible());
    }
    const observer = new MutationObserver(() => {
      if (visible()) finish();
    });
    // An optional/missing target is skipped instead of blocking the tour.
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
  const advancing = useRef(false);
  const stopping = useRef(false);
  const stepIndex = useRef<number | undefined>(undefined);
  const tourDriver = useRef<Driver | undefined>(undefined);
  const targetWait = useRef<AbortController | undefined>(undefined);
  const probe = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<GuideGeometry>();
  const [idle, setIdle] = useState(false);
  const cancel = useGuideStore((state) => state.cancel);
  const finish = useGuideStore((state) => state.finish);
  const setTarget = useGuideStore((state) => state.setTarget);

  const goToStep = useCallback(
    async (nextIndex: number): Promise<void> => {
      const definition = GUIDE_STEPS[nextIndex];
      const activeDriver = tourDriver.current;
      if (!definition || !activeDriver || advancing.current) return;

      targetWait.current?.abort();
      const controller = new AbortController();
      targetWait.current = controller;
      advancing.current = true;
      stepIndex.current = nextIndex;
      setTarget(definition.target);
      navigation.current(definition.route, { replace: true });

      const visible = await waitForGuideTarget(
        guideSelector(definition.target),
        controller.signal,
      );
      advancing.current = false;
      if (
        controller.signal.aborted ||
        targetWait.current !== controller ||
        !activeDriver.isActive()
      ) {
        return;
      }

      if (visible) {
        activeDriver.drive(nextIndex);
      } else if (nextIndex === GUIDE_STEPS.length - 1) {
        activeDriver.destroy();
      } else {
        activeDriver.drive(nextIndex + 1);
      }
    },
    [setTarget],
  );

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

  const steps = useMemo<DriveStep[]>(
    () =>
      GUIDE_STEPS.map((definition, index) => ({
        element: guideSelector(definition.target),
        popover: {
          title: t(definition.titleKey),
          description: t(definition.bodyKey),
          side: "bottom",
          align: "center",
          onNextClick:
            index < GUIDE_STEPS.length - 1
              ? () => {
                  void goToStep(index + 1);
                }
              : undefined,
          onPrevClick:
            index > 0
              ? () => {
                  void goToStep(index - 1);
                }
              : undefined,
        },
      })),
    [goToStep, t],
  );

  const driverConfig = useMemo<Config>(
    () => ({
      animate: true,
      allowClose: true,
      allowScroll: false,
      allowKeyboardControl: false,
      advanceOn: false,
      disableActiveInteraction: true,
      overlayClickBehavior: "none",
      overlayOpacity: 0.72,
      showProgress: true,
      showButtons: ["next", "previous", "close"],
      progressText: t("guideProgress", {
        current: "{{current}}",
        total: "{{total}}",
      }),
      nextBtnText: t("guideNext"),
      prevBtnText: t("guideBack"),
      doneBtnText: t("guideDone"),
      closeBtnLabel: t("guideSkip"),
      popoverClass: "guide-driver-popover",
      stagePadding: (geometry?.rem ?? 1) * 0.25,
      stageRadius: (geometry?.rem ?? 1) * 0.5,
      popoverOffset: (geometry?.rem ?? 1) * 0.5,
      waitForElement: 5000,
      skipMissingElement: true,
      onPopoverRender: (popover) => {
        displayed.current = true;
        // Driver puts its close control in the corner; keep the tour's skip
        // affordance in the footer position used by the previous tooltip.
        popover.closeButton.textContent = t("guideSkip");
        popover.footerButtons.prepend(popover.closeButton);
      },
      onDestroyStarted: (_element, _step, options) => {
        options.driver.destroy();
      },
      onDestroyed: (_element, _step, options) => {
        if (stopping.current) return;

        const reason = options.reason;
        if (reason === "done" && displayed.current) {
          useGuideStore.getState().openDemo();
        } else if (reason === "done" || reason === "close") {
          finish();
        } else {
          cancel();
          useNotificationStore
            .getState()
            .notify(t("guideUnavailable"), { tone: "warning" });
        }
        navigation.current(returnPath.current, { replace: true });
      },
    }),
    [cancel, finish, geometry, t],
  );

  useEffect(() => {
    if (!idle || !geometry) return;

    const instance = driver(driverConfig);
    instance.setSteps(steps);
    tourDriver.current = instance;
    displayed.current = false;
    advancing.current = false;
    stopping.current = false;
    void goToStep(stepIndex.current ?? 0);

    return () => {
      stopping.current = true;
      targetWait.current?.abort();
      targetWait.current = undefined;
      tourDriver.current = undefined;
      instance.destroy();
    };
  }, [driverConfig, geometry, goToStep, idle, steps]);

  return (
    <>
      {/* Resolve the existing CSS safe-area variables for tour geometry. */}
      <div
        ref={probe}
        aria-hidden="true"
        className="pointer-events-none invisible fixed inset-x-0 top-[var(--tt-safe-top)] bottom-[var(--tt-safe-bottom)] mx-auto max-w-md"
      />
    </>
  );
}
