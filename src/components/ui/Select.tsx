import { ChevronDown } from "lucide-react";

export interface SelectItem {
  value: string;
  label: string;
}

interface SelectProps {
  items: SelectItem[];
  onValueChange: (value: string) => void;
  value?: string;
  labelledBy?: string;
  className?: string;
}

/**
 * 原生 select 封装：外观走主题变量，弹出面板交给平台
 * （Android WebView 会直接弹系统选择器，比自绘下拉更适合触屏）。
 */
export function Select({ items, onValueChange, value, labelledBy, className }: SelectProps) {
  return (
    <span className={`relative block ${className ?? ""}`}>
      <select
        aria-labelledby={labelledBy}
        className="h-11 w-full appearance-none rounded-md border border-line bg-raised pl-3 pr-9 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        value={value ?? items[0]?.value}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-muted"
      />
    </span>
  );
}
