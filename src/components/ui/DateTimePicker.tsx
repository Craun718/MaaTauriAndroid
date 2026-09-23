import { type ReactNode, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import {
  type DateTimeParts,
  dateTimePartsToEpochMs,
  daysInMonth,
  epochMsToDateTimeParts,
} from "../../lib/schedules";
import { Modal } from "./Modal";
import { WheelPicker } from "./WheelPicker";

interface DateTimePickerFieldProps {
  label?: ReactNode;
  /** 本地时区 epoch 毫秒。 */
  value: number;
  onValueChange: (value: number) => void;
  className?: string;
}

const MINUTE_ITEMS = Array.from({ length: 60 }, (_, minute) =>
  String(minute).padStart(2, "0"),
);

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

/**
 * 日期时间字段：只读按钮打开居中模态框，内嵌年/月/日/时/分五列滚轮，
 * 取代 WebView 原生 input[type=datetime-local] 弹层。
 */
export function DateTimePickerField({
  label,
  value,
  onValueChange,
  className,
}: DateTimePickerFieldProps) {
  const { t, language } = useTranslation();
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<DateTimeParts>(() =>
    epochMsToDateTimeParts(Date.now()),
  );

  const currentYear = new Date().getFullYear();
  const years = range(currentYear - 1, currentYear + 10);
  const days = range(1, daysInMonth(parts.year, parts.month));

  function openPicker() {
    const next =
      Number.isFinite(value) && value >= 0
        ? epochMsToDateTimeParts(value)
        : epochMsToDateTimeParts(Date.now());
    next.year = Math.min(
      Math.max(next.year, years[0]),
      years[years.length - 1],
    );
    setParts(next);
    setOpen(true);
  }

  function update(next: Partial<DateTimeParts>) {
    setParts((prev) => {
      const merged = { ...prev, ...next };
      // 年月变化后天数可能变少，收缩日到当月最后一天。
      const maxDay = daysInMonth(merged.year, merged.month);
      return { ...merged, day: Math.min(merged.day, maxDay) };
    });
  }

  function confirm() {
    const epochMs = dateTimePartsToEpochMs(parts);
    if (epochMs >= 0) onValueChange(epochMs);
    setOpen(false);
  }

  const display = new Intl.DateTimeFormat(
    language === "zh" ? "zh-CN" : "en-US",
    { dateStyle: "medium", timeStyle: "short" },
  ).format(new Date(value));

  return (
    <span className={`block ${className ?? ""}`}>
      {label && (
        <span className="mb-1 block text-sm text-base-content/60">{label}</span>
      )}
      <button
        type="button"
        onClick={openPicker}
        className="input w-full cursor-pointer text-left"
      >
        {display}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("scheduleIntervalStart")}
      >
        <div className="space-y-3 pt-2">
          <div className="grid grid-cols-3 gap-2">
            <p className="text-center text-sm text-base-content/60">
              {t("pickerYear")}
            </p>
            <p className="text-center text-sm text-base-content/60">
              {t("pickerMonth")}
            </p>
            <p className="text-center text-sm text-base-content/60">
              {t("pickerDay")}
            </p>
            <WheelPicker
              items={years.map(String)}
              value={years.indexOf(parts.year)}
              onValueChange={(index) => update({ year: years[index] })}
              ariaLabel={t("pickerYear")}
            />
            <WheelPicker
              items={range(1, 12).map(pad)}
              value={parts.month - 1}
              onValueChange={(index) => update({ month: index + 1 })}
              ariaLabel={t("pickerMonth")}
            />
            <WheelPicker
              items={days.map(String)}
              value={parts.day - 1}
              onValueChange={(index) => update({ day: index + 1 })}
              ariaLabel={t("pickerDay")}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <p className="text-center text-sm text-base-content/60">
              {t("pickerHour")}
            </p>
            <p className="text-center text-sm text-base-content/60">
              {t("pickerMinute")}
            </p>
            <WheelPicker
              items={range(0, 23).map(pad)}
              value={parts.hour}
              onValueChange={(index) => update({ hour: index })}
              ariaLabel={t("pickerHour")}
            />
            <WheelPicker
              items={MINUTE_ITEMS}
              value={parts.minute}
              onValueChange={(index) => update({ minute: index })}
              ariaLabel={t("pickerMinute")}
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-10 rounded-md border border-line px-3"
          >
            {t("scheduleCancel")}
          </button>
          <button
            type="button"
            onClick={confirm}
            className="h-10 rounded-md bg-accent px-3 font-medium text-white"
          >
            {t("confirm")}
          </button>
        </div>
      </Modal>
    </span>
  );
}
