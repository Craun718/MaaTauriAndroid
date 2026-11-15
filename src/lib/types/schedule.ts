export type ScheduleTrigger =
  | { kind: "fixedTime"; days: number[]; times: string[] }
  | {
      kind: "interval";
      startEpochMs: number;
      intervalDays: number;
      intervalHours: number;
    };

export interface ScheduleRule {
  id: string;
  name: string;
  enabled: boolean;
  autoStart: boolean;
  runConfigurationId: string;
  forceStart: boolean;
  trigger: ScheduleTrigger;
}

export type ScheduleRuleStatus = ScheduleRule & {
  nextTriggerEpochMs?: number;
};

export type ScheduleTriggerResult =
  | "started"
  | "duplicate"
  | "rejectedActive"
  | "failedValidation"
  | "failedServiceStart"
  | "foregroundServiceDenied"
  | "missed";

export interface ScheduleTriggerLogEntry {
  ruleId: string;
  scheduledEpochMs: number;
  actualEpochMs: number;
  result: ScheduleTriggerResult;
  detail?: string | null;
}

export interface ScheduleSummary {
  ruleCount: number;
  enabledCount: number;
  nextTriggerEpochMs?: number;
  lastTrigger?: ScheduleTriggerLogEntry;
}

/** Prerequisites a scheduled run depends on, probed for the schedule page. */
export interface ScheduleHealth {
  backendAvailable: boolean;
  backendGranted: boolean;
  batteryWhitelisted: boolean;
  exactAlarmAllowed: boolean;
  notificationsAllowed: boolean;
  overlayAllowed: boolean;
  /** Vendor or app-details guide target; absent on unrestricted ROMs. */
  autostartGuide?: string | null;
}
