import { type ReactNode, useId } from "react";

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
 * 卡片式单选列表：整块卡片可点，圆点控件用 sr-only 隐去（仍然可聚焦、可被读屏识别），
 * 选中态与焦点环通过 has-checked: / has-focus-visible: 挂在 label 上。
 * 颜色走 daisyUI 语义 token（base-100 / base-300 / primary），与其它控件同一套主题。
 */
const itemAppearance =
  "flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg border border-base-300 bg-base-100 p-3 text-left transition-colors duration-[120ms] [-webkit-tap-highlight-color:transparent] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary has-checked:border-primary has-checked:bg-primary/12 has-checked:text-primary";

export function RadioGroup({
  items,
  onValueChange,
  value,
  labelledBy,
  className,
}: RadioGroupProps) {
  // 原生 radio 需要同名才能成组；useId 保证同一页面上多组互不干扰。
  const name = useId();

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className={`flex flex-col ${className ?? ""}`}
    >
      {items.map((item) => (
        <label key={item.value} className={itemAppearance}>
          <input
            type="radio"
            name={name}
            className="sr-only"
            checked={value === item.value}
            onChange={() => onValueChange(item.value)}
          />
          <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
            {item.content}
          </span>
        </label>
      ))}
    </div>
  );
}
