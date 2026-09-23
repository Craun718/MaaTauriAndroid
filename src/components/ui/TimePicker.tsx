import { type ReactNode, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import { Modal } from "./Modal";
import { WheelPicker } from "./WheelPicker";

interface TimePickerFieldProps {
  label?: ReactNode;
  /** 24 小时制 "HH:mm"。 */
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

interface TimePickerDialogProps {
  /** 24 小时制 "HH:mm"，弹窗打开时的初始值。 */
  value: string;
  title?: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const HOURS = Array.from({ length: 24 }, (_, hour) =>
  String(hour).padStart(2, "0"),
);
const MINUTES = Array.from({ length: 60 }, (_, minute) =>
  String(minute).padStart(2, "0"),
);

/**
 * 时间选择弹窗：内嵌时/分两列滚轮。调用方按需挂载，确认时才提交结果。
 */
export function TimePickerDialog({
  value,
  title,
  onConfirm,
  onClose,
}: TimePickerDialogProps) {
  const { t } = useTranslation();
  const match = TIME_PATTERN.exec(value);
  const [hour, setHour] = useState(match ? Number(match[1]) : 8);
  const [minute, setMinute] = useState(match ? Number(match[2]) : 0);

  function confirm() {
    onConfirm(
      `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    );
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={title ?? t("scheduleTime")}>
      <div className="grid grid-cols-2 gap-3 pt-2">
        <p className="text-center text-sm text-base-content/60">
          {t("pickerHour")}
        </p>
        <p className="text-center text-sm text-base-content/60">
          {t("pickerMinute")}
        </p>
        <WheelPicker
          items={HOURS}
          value={hour}
          onValueChange={setHour}
          ariaLabel={t("pickerHour")}
        />
        <WheelPicker
          items={MINUTES}
          value={minute}
          onValueChange={setMinute}
          ariaLabel={t("pickerMinute")}
        />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="h-10 rounded-md border border-line px-3"
        >
          {t("scheduleCancel")}
        </button>
        <button
          type="button"
          onClick={confirm}
          className="h-10 rounded-md bg-accent px-3 font-medium text-primary-content"
        >
          {t("confirm")}
        </button>
      </div>
    </Modal>
  );
}

/**
 * 时间字段：只读按钮打开居中模态框，确认后更新字段值。
 */
export function TimePickerField({
  label,
  value,
  onValueChange,
  className,
}: TimePickerFieldProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  function openPicker() {
    setOpen(true);
  }

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
        {value}
      </button>
      {open && (
        <TimePickerDialog
          value={value}
          title={t("scheduleTime")}
          onConfirm={onValueChange}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}
