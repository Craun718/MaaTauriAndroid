import { useState } from "react";

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  onValueChange: (value: number) => void;
  onValueCommit: (value: number) => void;
}

/**
 * daisyUI 滑杆。拖动只更新草稿用于实时预览，松手或焦点离开时由调用方落盘，
 * 避免一次手势生成大量配置写入。
 */
export function Slider({
  value,
  min,
  max,
  step = 1,
  ariaLabel,
  disabled = false,
  className,
  onValueChange,
  onValueCommit,
}: SliderProps) {
  const [dragging, setDragging] = useState(false);
  const [dirty, setDirty] = useState(false);
  const commit = (nextValue: number) => {
    setDirty(false);
    onValueCommit(nextValue);
  };

  return (
    <input
      type="range"
      aria-label={ariaLabel}
      className={`range range-primary w-full ${disabled ? "cursor-not-allowed opacity-50" : ""} ${
        className ?? ""
      }`}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(event) => {
        setDirty(true);
        onValueChange(Number(event.currentTarget.value));
      }}
      onPointerDown={() => {
        setDragging(true);
      }}
      onPointerUp={() => {
        setDragging(false);
        if (dirty) commit(value);
      }}
      onPointerCancel={() => {
        setDragging(false);
        if (dirty) commit(value);
      }}
      onKeyUp={() => {
        if (dirty && !dragging) commit(value);
      }}
      onBlur={() => {
        if (dirty && !dragging) commit(value);
      }}
    />
  );
}
