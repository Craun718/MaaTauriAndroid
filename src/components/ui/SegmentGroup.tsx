import { SegmentGroup as ArkSegmentGroup } from "@ark-ui/react/segment-group";
import type { ReactNode } from "react";

export interface SegmentGroupItem {
  value: string;
  label: string;
  description?: ReactNode;
}

interface SegmentGroupProps {
  items: SegmentGroupItem[];
  onValueChange: (value: string) => void;
  value?: string;
  label?: ReactNode;
  description?: ReactNode;
  columns?: number;
}

/**
 * Ark UI 分段选择（单选标签组）。无选中值时传 undefined，组件内部会转成 null，
 * 以保持「受控但无选择」的语义与默认值展示互不干扰。
 * 外观与 RadioGroup 共用同一套状态规则（border / bg / text 随 data-state 切换），
 * 通过 Tailwind 类定义在本封装内。
 */
const itemAppearance =
  "flex cursor-pointer border border-line bg-raised transition-colors duration-[120ms] [-webkit-tap-highlight-color:transparent] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent data-[state=checked]:border-accent data-[state=checked]:bg-accent/12 data-[state=checked]:text-accent data-disabled:cursor-not-allowed data-disabled:opacity-50";

export function SegmentGroup({
  items,
  onValueChange,
  value,
  label,
  description,
  columns = 3,
}: SegmentGroupProps) {
  return (
    <ArkSegmentGroup.Root
      value={value ?? null}
      orientation="horizontal"
      onValueChange={(details) => {
        if (details.value !== null) onValueChange(details.value);
      }}
    >
      {(label || description) && (
        <div className="mb-3 flex min-h-11 flex-wrap items-center justify-between gap-2">
          <div>
            {label && (
              <ArkSegmentGroup.Label className="block font-medium">
                {label}
              </ArkSegmentGroup.Label>
            )}
            {description && <div className="text-sm text-ink-muted">{description}</div>}
          </div>
        </div>
      )}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {items.map((item) => (
          <ArkSegmentGroup.Item
            key={item.value}
            value={item.value}
            className={
              item.description
                ? `${itemAppearance} min-h-10 flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left text-sm font-medium`
                : `${itemAppearance} h-10 rounded-md px-3 text-sm font-medium`
            }
          >
            <ArkSegmentGroup.ItemText>{item.label}</ArkSegmentGroup.ItemText>
            {item.description && (
              <div className="w-full text-xs font-normal">{item.description}</div>
            )}
            <ArkSegmentGroup.ItemControl className="hidden" />
            <ArkSegmentGroup.ItemHiddenInput />
          </ArkSegmentGroup.Item>
        ))}
      </div>
    </ArkSegmentGroup.Root>
  );
}
