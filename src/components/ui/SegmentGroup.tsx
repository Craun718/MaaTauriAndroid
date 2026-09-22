import { type ReactNode, useId } from "react";

export interface SegmentGroupItem {
  value: string;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}

interface SegmentGroupProps {
  items: SegmentGroupItem[];
  onValueChange: (value: string) => void;
  value?: string;
  label?: ReactNode;
  description?: ReactNode;
  columns?: number;
  compact?: boolean;
  disabled?: boolean;
}

/**
 * 分段选择（单选标签组）。无选中值时传 undefined，原生 radio 都不选中，
 * 以保持「受控但无选择」的语义与默认值展示互不干扰。
 * 外观与 RadioGroup 共用同一套状态规则（border / bg / text 随选中态切换），
 * 通过 Tailwind 类定义在本封装内，颜色走 daisyUI 语义 token。
 */
const itemAppearance =
  "flex cursor-pointer border border-base-300 bg-base-100 transition-colors duration-[120ms] [-webkit-tap-highlight-color:transparent] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary has-checked:border-primary has-checked:bg-primary/12 has-checked:text-primary";

export function SegmentGroup({
  items,
  onValueChange,
  value,
  label,
  description,
  columns = 3,
  compact = false,
  disabled = false,
}: SegmentGroupProps) {
  const groupId = useId();
  const labelId = `${groupId}-label`;

  return (
    <div role="radiogroup" aria-labelledby={label ? labelId : undefined}>
      {(label || description) && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 ${
            compact ? "mb-2 min-h-9" : "mb-3 min-h-11"
          }`}
        >
          <div>
            {label && (
              <span id={labelId} className="block font-medium">
                {label}
              </span>
            )}
            {description && (
              <div className="text-sm text-base-content/60">{description}</div>
            )}
          </div>
        </div>
      )}
      <div
        className={`grid ${compact ? "gap-1.5" : "gap-2"}`}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {items.map((item) => (
          <label
            key={item.value}
            className={
              item.description
                ? `${itemAppearance} ${
                    item.disabled || disabled
                      ? "cursor-not-allowed opacity-50"
                      : "cursor-pointer"
                  } ${compact ? "min-h-9" : "min-h-10"} flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left text-sm font-medium`
                : `${
                    compact
                      ? `${itemAppearance} ${
                          item.disabled || disabled
                            ? "cursor-not-allowed opacity-50"
                            : "cursor-pointer"
                        } h-9 rounded-md px-2.5 text-sm font-medium`
                      : `${itemAppearance} ${
                          item.disabled || disabled
                            ? "cursor-not-allowed opacity-50"
                            : "cursor-pointer"
                        } h-10 rounded-md px-2.5 text-sm font-medium`
                  }`
            }
          >
            <input
              type="radio"
              name={groupId}
              className="sr-only"
              checked={value === item.value}
              disabled={disabled || item.disabled}
              onChange={() => onValueChange(item.value)}
            />
            <span>{item.label}</span>
            {item.description && (
              <div className="w-full text-xs font-normal">
                {item.description}
              </div>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}
