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
  /** 单行（无 description）按钮文字水平居中；带 description 的按钮保持左对齐。 */
  centered?: boolean;
}

/**
 * 分段选择（单选标签组）。无选中值时传 undefined，原生 radio 都不选中，
 * 以保持「受控但无选择」的语义与默认值展示互不干扰。
 * 外观与 RadioGroup 共用同一套状态规则（border / bg / text 随选中态切换），
 * 通过 Tailwind 类定义在本封装内，颜色走 daisyUI 语义 token。
 * 带描述的按钮固定左对齐（描述文字需要可读的起始边）；
 * 单行按钮默认左对齐，`centered` 时水平居中。
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
  centered = false,
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
        {items.map((item) => {
          const stateClasses =
            item.disabled || disabled
              ? "cursor-not-allowed opacity-50"
              : "cursor-pointer";
          const sizeClass = compact
            ? item.description
              ? "min-h-9"
              : "h-9"
            : item.description
              ? "min-h-10"
              : "h-10";
          const alignClass = item.description
            ? "flex-col items-start gap-0.5 py-2 text-left"
            : centered
              ? "justify-center text-center"
              : "";
          return (
            <label
              key={item.value}
              className={`${itemAppearance} ${stateClasses} ${sizeClass} ${alignClass} rounded-md px-2.5 text-sm font-medium`}
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
          );
        })}
      </div>
    </div>
  );
}
