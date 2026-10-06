export const STARTUP_STAGES = [
  "frontend_bootstrap",
  "frontend_prepare_app_return",
  "frontend_parse",
  "frontend_ui_ready",
] as const;

export type StartupStage = (typeof STARTUP_STAGES)[number];

export interface StartupStageTiming {
  stage: StartupStage;
  elapsedMs: number;
}

export interface StartupTrace {
  record: (stage: StartupStage) => void;
  flush: (report: (line: string) => void) => void;
}

export function formatStartupStageTiming(timing: StartupStageTiming): string {
  return `startup stage=${timing.stage} elapsed_ms=${timing.elapsedMs}`;
}

export function createStartupTrace(
  now: () => number = () => performance.now(),
): StartupTrace {
  const startedAt = now();
  const timings: StartupStageTiming[] = [];
  const recorded = new Set<StartupStage>();
  let flushed = false;

  return {
    record(stage) {
      if (recorded.has(stage)) return;
      recorded.add(stage);
      timings.push({
        stage,
        elapsedMs: Math.max(0, Math.round(now() - startedAt)),
      });
    },
    flush(report) {
      if (flushed) return;
      flushed = true;
      for (const timing of timings) report(formatStartupStageTiming(timing));
    },
  };
}

export const startupTrace = createStartupTrace();
