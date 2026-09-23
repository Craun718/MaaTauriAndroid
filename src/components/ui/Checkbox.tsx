import type { ReactNode } from "react";

interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * daisyUI 复选框。外观（边框、选中态、焦点环）由 .checkbox / .checkbox-primary 提供，
 * 颜色与圆角来自 index.css 里 "maa-tauri-android" 主题的 token；className 只负责调用处的布局。
 * 原生 input 直接承载选中态，因此读屏与 Testing Library 都能直接命中它。
 */
export function Checkbox({
  checked,
  onCheckedChange,
  children,
  disabled,
  className,
}: CheckboxProps) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 [-webkit-tap-highlight-color:transparent] ${
        disabled ? "cursor-not-allowed opacity-50" : ""
      } ${className ?? ""}`}
    >
      <input
        type="checkbox"
        className="checkbox checkbox-sm checkbox-primary"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}
