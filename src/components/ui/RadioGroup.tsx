import { RadioGroup as ArkRadioGroup } from "@ark-ui/react/radio-group";
import type { ReactNode } from "react";

export interface RadioGroupItem {
  value: string;
  content: ReactNode;
}

interface RadioGroupProps {
  items: RadioGroupItem[];
  onValueChange: (value: string) => void;
  value?: string;
  labelledBy?: string;
  className?: string;
}

/**
 * Ark UI 单选组，用于「卡片式单选」列表（外观与分段选择共用 index.css 的状态规则）。
 */
export function RadioGroup({
  items,
  onValueChange,
  value,
  labelledBy,
  className,
}: RadioGroupProps) {
  return (
    <ArkRadioGroup.Root
      className={className}
      value={value ?? null}
      aria-labelledby={labelledBy}
      onValueChange={(details) => {
        if (details.value !== null) onValueChange(details.value);
      }}
    >
      {items.map((item) => (
        <ArkRadioGroup.Item
          key={item.value}
          value={item.value}
          className="flex min-h-14 w-full items-center gap-3 rounded-lg p-3 text-left"
        >
          <ArkRadioGroup.ItemText className="flex min-w-0 flex-1 items-center justify-between gap-2">
            {item.content}
          </ArkRadioGroup.ItemText>
          <ArkRadioGroup.ItemControl />
          <ArkRadioGroup.ItemHiddenInput />
        </ArkRadioGroup.Item>
      ))}
    </ArkRadioGroup.Root>
  );
}
