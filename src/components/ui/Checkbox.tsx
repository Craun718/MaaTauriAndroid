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
 * Ark UI 复选框。外观（边框、选中态、焦点环）通过 Tailwind 类定义在本封装内，
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
      className={`group flex cursor-pointer items-center gap-3 [-webkit-tap-highlight-color:transparent] data-disabled:cursor-not-allowed data-disabled:opacity-50 ${
        className ?? ""
      }`}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(details) => onCheckedChange(details.checked === true)}
    >
      <ArkCheckbox.Control className="grid size-5 shrink-0 place-items-center rounded-md border border-line bg-raised transition-colors duration-[120ms] group-has-focus-visible:outline-2 group-has-focus-visible:outline-offset-2 group-has-focus-visible:outline-accent data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-white data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:text-white">
        <ArkCheckbox.Indicator className="grid place-items-center">
          <Check size={14} strokeWidth={3} />
        </ArkCheckbox.Indicator>
      </ArkCheckbox.Control>
      <ArkCheckbox.Label>{children}</ArkCheckbox.Label>
      <ArkCheckbox.HiddenInput />
    </ArkCheckbox.Root>
  );
}
