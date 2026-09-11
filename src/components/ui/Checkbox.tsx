import { Checkbox as ArkCheckbox } from "@ark-ui/react/checkbox";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * Ark UI 复选框。外观由 index.css 的 [data-scope="checkbox"] 规则统一控制，
 * className 只负责调用处的布局。
 */
export function Checkbox({
  checked,
  onCheckedChange,
  children,
  disabled,
  className,
}: CheckboxProps) {
  return (
    <ArkCheckbox.Root
      className={className}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(details) => onCheckedChange(details.checked === true)}
    >
      <ArkCheckbox.Control>
        <ArkCheckbox.Indicator>
          <Check size={14} strokeWidth={3} />
        </ArkCheckbox.Indicator>
      </ArkCheckbox.Control>
      <ArkCheckbox.Label>{children}</ArkCheckbox.Label>
      <ArkCheckbox.HiddenInput />
    </ArkCheckbox.Root>
  );
}
