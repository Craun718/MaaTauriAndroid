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
 */
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
            {description && (
              <div className="text-sm text-[var(--text-muted)]">{description}</div>
            )}
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
                ? "min-h-10 flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left text-sm font-medium"
                : "h-10 rounded-md px-3 text-sm font-medium"
            }
          >
            <ArkSegmentGroup.ItemText>{item.label}</ArkSegmentGroup.ItemText>
            {item.description && (
              <div className="w-full text-xs font-normal">{item.description}</div>
            )}
            <ArkSegmentGroup.ItemControl />
            <ArkSegmentGroup.ItemHiddenInput />
          </ArkSegmentGroup.Item>
        ))}
      </div>
    </ArkSegmentGroup.Root>
  );
}
