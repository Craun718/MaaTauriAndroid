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
 * daisyUI 下拉选择，底层仍是原生 <select>：弹出面板交给平台
 * （Android WebView 会直接弹系统选择器，比自绘下拉更适合触屏）。
 * 箭头、边框、高度由 .select 提供，不再自己叠图标。
 */
export function Select({
  items,
  onValueChange,
  value,
  labelledBy,
  className,
}: SelectProps) {
  return (
    <span className={`block ${className ?? ""}`}>
      <select
        aria-labelledby={labelledBy}
        className="select w-full"
        value={value ?? items[0]?.value}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </span>
  );
}
