import { Tabs as ArkTabs } from "@ark-ui/react/tabs";
import type { ReactNode } from "react";

export interface TabsItem {
  value: string;
  label: ReactNode;
  content: ReactNode;
}

interface TabsProps {
  items: TabsItem[];
  value?: string;
  onValueChange?: (value: string) => void;
  /** 无障碍名称，描述整组标签的用途。 */
  ariaLabel?: string;
}

/**
 * Ark UI 标签页封装。内容默认 unmountOnExit：切走的标签页立即卸载，
 * 避免隐藏内容残留在 DOM 里（重复的 heading / 控件会干扰查询与读屏）。
 * 外观通过 Tailwind 类定义在本封装内。
 */
export function Tabs({ items, value, onValueChange, ariaLabel }: TabsProps) {
  return (
    <ArkTabs.Root
      value={value}
      defaultValue={items[0]?.value}
      onValueChange={(details) => onValueChange?.(details.value)}
      aria-label={ariaLabel}
      unmountOnExit
    >
      <ArkTabs.List className="flex gap-1.5 overflow-x-auto rounded-lg border border-line bg-surface-muted p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => (
          <ArkTabs.Trigger
            key={item.value}
            value={item.value}
            className="flex min-h-9 shrink-0 cursor-pointer items-center rounded-md px-3.5 text-sm font-medium text-ink-muted transition-colors duration-[120ms] [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-selected:bg-raised data-selected:text-ink"
          >
            {item.label}
          </ArkTabs.Trigger>
        ))}
      </ArkTabs.List>
      {items.map((item) => (
        <ArkTabs.Content
          key={item.value}
          value={item.value}
          className="focus-visible:outline-none"
        >
          {item.content}
        </ArkTabs.Content>
      ))}
    </ArkTabs.Root>
  );
}
