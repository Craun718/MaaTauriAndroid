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
 * Ark UI 文本输入。输入框外观由 index.css 的 [data-scope="field"] 规则控制，
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
    <Field.Root className={className} disabled={disabled}>
      {label && <Field.Label>{label}</Field.Label>}
      <Field.Input
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(event) => onValueChange(event.target.value)}
      />
      {error && <Field.ErrorText>{error}</Field.ErrorText>}
      {description && <Field.HelperText>{description}</Field.HelperText>}
    </Field.Root>
  );
}
