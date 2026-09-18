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
      <ArkTabs.List>
        {items.map((item) => (
          <ArkTabs.Trigger key={item.value} value={item.value}>
            {item.label}
          </ArkTabs.Trigger>
        ))}
      </ArkTabs.List>
      {items.map((item) => (
        <ArkTabs.Content key={item.value} value={item.value}>
          {item.content}
        </ArkTabs.Content>
      ))}
    </ArkTabs.Root>
  );
}
