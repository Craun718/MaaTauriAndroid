import type { ReactNode } from "react";

interface TextFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  label?: ReactNode;
  type?: "text" | "password";
  inputMode?: "text" | "numeric";
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  error?: ReactNode;
  description?: ReactNode;
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
  className,
  error,
  description,
}: TextFieldProps) {
  return (
    <label
      className={`block ${
        disabled ? "cursor-not-allowed opacity-50" : ""
      } ${className ?? ""}`}
    >
      {label && (
        <span className="mb-1 block text-sm text-base-content/60">{label}</span>
      )}
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        className="input w-full"
        onChange={(event) => onValueChange(event.target.value)}
      />
      {error && (
        <span className="mt-1.5 block text-[0.8125rem] text-error">
          {error}
        </span>
      )}
      {description && (
        <span className="mt-1.5 block text-[0.8125rem]">{description}</span>
      )}
    </label>
  );
}
