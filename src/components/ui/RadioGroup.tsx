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
 * Ark UI 单选组，用于「卡片式单选」列表。整块卡片可点，Ark 自带的圆点控件
 * （ItemControl）隐藏；选中态、焦点环等外观通过 Tailwind 类定义在本封装内。
 */
const itemAppearance =
  "flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg border border-line bg-raised p-3 text-left transition-colors duration-[120ms] [-webkit-tap-highlight-color:transparent] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent data-[state=checked]:border-accent data-[state=checked]:bg-accent/12 data-[state=checked]:text-accent data-disabled:cursor-not-allowed data-disabled:opacity-50";

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
        <ArkRadioGroup.Item key={item.value} value={item.value} className={itemAppearance}>
          <ArkRadioGroup.ItemText className="flex min-w-0 flex-1 items-center justify-between gap-2">
            {item.content}
          </ArkRadioGroup.ItemText>
          <ArkRadioGroup.ItemControl className="hidden" />
          <ArkRadioGroup.ItemHiddenInput />
        </ArkRadioGroup.Item>
      ))}
    </ArkRadioGroup.Root>
  );
}
