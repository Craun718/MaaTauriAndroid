import { Field } from "@ark-ui/react/field";
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
 * Ark UI 文本输入。输入框外观（边框、焦点环、禁用态）通过 Tailwind 类定义在本封装内，
 * className 作用于 Field.Root（外层容器）。
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
    <Field.Root
      className={`block data-disabled:cursor-not-allowed data-disabled:opacity-50 ${className ?? ""}`}
      disabled={disabled}
    >
      {label && <Field.Label className="mb-1 block text-sm text-ink-muted">{label}</Field.Label>}
      <Field.Input
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="block h-11 w-full rounded-md border border-line bg-raised px-3 text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed"
        onChange={(event) => onValueChange(event.target.value)}
      />
      {error && (
        <Field.ErrorText className="mt-1.5 block text-[0.8125rem]">{error}</Field.ErrorText>
      )}
      {description && (
        <Field.HelperText className="mt-1.5 block text-[0.8125rem]">{description}</Field.HelperText>
      )}
    </Field.Root>
  );
}
