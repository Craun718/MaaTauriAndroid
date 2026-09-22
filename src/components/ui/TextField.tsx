import type { ReactNode } from "react";

interface TextFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  label?: ReactNode;
  type?: "text" | "password" | "time" | "datetime-local";
  inputMode?: "text" | "numeric";
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  onBlur?: () => void;
  className?: string;
  error?: ReactNode;
  description?: ReactNode;
  compact?: boolean;
}

/**
 * daisyUI 文本输入。输入框外观（边框、焦点环、禁用态、高度）由 .input 提供，
 * 高度与圆角来自 "ttflow" 主题的 --size-field / --radius-field；
 * className 作用于外层 <label> 容器。
 */
export function TextField({
  value,
  onValueChange,
  label,
  type = "text",
  inputMode,
  placeholder,
  disabled,
  ariaLabel,
  onBlur,
  className,
  error,
  description,
  compact = false,
}: TextFieldProps) {
  return (
    <label
      className={`block ${
        disabled ? "cursor-not-allowed opacity-50" : ""
      } ${className ?? ""}`}
    >
      {label && (
        <span
          className={`block text-sm text-base-content/60 ${
            compact ? "mb-0.5" : "mb-1"
          }`}
        >
          {label}
        </span>
      )}
      <input
        type={type}
        inputMode={type === "text" ? inputMode : undefined}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        className="input w-full"
        onChange={(event) => onValueChange(event.target.value)}
        onBlur={onBlur}
      />
      {error && (
        <span
          className={`block text-[0.8125rem] text-error ${
            compact ? "mt-1" : "mt-1.5"
          }`}
        >
          {error}
        </span>
      )}
      {description && (
        <span
          className={`block text-[0.8125rem] ${compact ? "mt-1" : "mt-1.5"}`}
        >
          {description}
        </span>
      )}
    </label>
  );
}
