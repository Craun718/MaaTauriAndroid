import { useCallback, useEffect, useRef } from "react";

interface WheelPickerProps {
  items: string[];
  /** 当前选中条目的下标。 */
  value: number;
  onValueChange: (index: number) => void;
  ariaLabel?: string;
  className?: string;
}

/**
 * iOS 风格滚轮列：scroll-snap 把条目吸附到滚动口中线，滚动停下即选中。
 * 条目高 2rem、可见 5 行（容器 h-40），上下各垫 4rem 空位让首尾条目也能
 * 居中。滚动过程中实时上报 round(scrollTop / 条目高)；外部 value 变化只在
 * 位置明显偏离时以 smooth 校正，避免打断触摸惯性滚动。
 */
export function WheelPicker({
  items,
  value,
  onValueChange,
  ariaLabel,
  className,
}: WheelPickerProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const itemHeightRef = useRef(0);
  const mountedRef = useRef(false);

  const itemHeight = useCallback((): number => {
    if (itemHeightRef.current) return itemHeightRef.current;
    const item =
      listRef.current?.querySelector<HTMLElement>("[data-wheel-item]");
    itemHeightRef.current = item?.getBoundingClientRect().height ?? 0;
    return itemHeightRef.current;
  }, []);

  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior = "auto") => {
      const height = itemHeight();
      if (!height) return;
      listRef.current?.scrollTo({ top: index * height, behavior });
    },
    [itemHeight],
  );

  useEffect(() => {
    const isMounted = mountedRef.current;
    mountedRef.current = true;
    const height = itemHeight();
    const list = listRef.current;
    if (!height || !list) return;
    if (Math.round(list.scrollTop / height) === value) return;
    scrollToIndex(value, isMounted ? "smooth" : "auto");
  }, [value, itemHeight, scrollToIndex]);

  function handleScroll() {
    const height = itemHeight();
    const list = listRef.current;
    if (!height || !list) return;
    const index = Math.max(
      0,
      Math.min(items.length - 1, Math.round(list.scrollTop / height)),
    );
    if (index !== value) onValueChange(index);
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 h-8 -translate-y-1/2 rounded-md bg-surface-muted"
      />
      <div
        ref={listRef}
        role="listbox"
        aria-label={ariaLabel}
        tabIndex={0}
        onScroll={handleScroll}
        className="relative h-40 snap-y snap-mandatory overflow-y-auto overscroll-contain [mask-image:linear-gradient(to_bottom,transparent,black_25%,black_75%,transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div aria-hidden className="h-16 shrink-0" />
        {items.map((label, index) => (
          <button
            key={label}
            type="button"
            data-wheel-item
            role="option"
            aria-selected={index === value}
            onClick={() => scrollToIndex(index, "smooth")}
            className={`flex h-8 w-full shrink-0 snap-center cursor-pointer items-center justify-center text-lg tabular-nums ${
              index === value ? "font-medium text-ink" : "text-ink-muted"
            }`}
          >
            {label}
          </button>
        ))}
        <div aria-hidden className="h-16 shrink-0" />
      </div>
    </div>
  );
}
