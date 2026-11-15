import { invoke } from "@tauri-apps/api/core";
import type {
  ScheduleHealth,
  ScheduleRule,
  ScheduleRuleStatus,
  ScheduleSummary,
} from "../types";

export async function listScheduleRules() {
  return invoke<Array<ScheduleRuleStatus>>("list_schedule_rules");
}

export async function saveScheduleRule(rule: ScheduleRule) {
  return invoke<ScheduleRule>("save_schedule_rule", { rule });
}

export async function deleteScheduleRule(id: string) {
  return invoke<void>("delete_schedule_rule", { id });
}

export async function setScheduleRuleEnabled(id: string, enabled: boolean) {
  return invoke<ScheduleRule>("set_schedule_rule_enabled", { id, enabled });
}

export async function getScheduleStatus() {
  return invoke<ScheduleSummary>("get_schedule_status");
}

export async function getScheduleHealth() {
  return invoke<ScheduleHealth>("schedule_health");
}

export async function openAutostartSettings() {
  return invoke<void>("open_autostart_settings");
}

export async function requestBatteryOptimizationExemption() {
  return invoke<void>("request_battery_optimization_exemption");
}

export async function requestExactAlarmPermission() {
  return invoke<void>("request_exact_alarm_permission");
}

export async function requestScheduleNotificationPermission() {
  return invoke<void>("request_schedule_notification_permission");
}
