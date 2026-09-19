import { type ReactNode, useId, useRef } from "react";

export interface TabsItem {
  value: string;
  label: ReactNode;
  content: ReactNode;
}

interface TabsProps {
  items: TabsItem[];
  value?: string;
  onValueChange?: (value: string) => void;
  /** 无障碍名称，描述整组标签的用途。 */
  ariaLabel?: string;
}

/**
 * daisyUI 标签页封装（tabs-box 外观）。只挂载当前选中的面板：切走的标签页立即卸载，
 * 避免隐藏内容残留在 DOM 里（重复的 heading / 控件会干扰查询与读屏）。
 *
 * 这里用 button + role="tab" 而不是 daisyUI 文档里的 radio input，原因是 radio 方案要求
 * 每个面板以 .tab-content 紧随其 tab 出现，内容会被一直挂在 DOM 里；而本封装需要按需挂载。
 * 键盘行为（roving tabindex + 左右方向键 / Home / End）因此由本组件自己实现。
 */
export function Tabs({ items, value, onValueChange, ariaLabel }: TabsProps) {
  const active = value ?? items[0]?.value;
  const groupId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const focusTab = (index: number) => {
    const tabs =
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[index]?.focus();
  };

  const selectAt = (index: number) => {
    const item = items[index];
    if (!item) return;
    onValueChange?.(item.value);
    focusTab(index);
  };

  const activeItem = items.find((item) => item.value === active);

  return (
    <>
      <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div
          ref={listRef}
          role="tablist"
          aria-label={ariaLabel}
          className="tabs tabs-box tabs-xs w-max min-w-full border border-base-300"
        >
          {items.map((item, index) => {
            const selected = item.value === active;
            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                id={`${groupId}-tab-${index}`}
                aria-selected={selected}
                aria-controls={selected ? `${groupId}-panel` : undefined}
                tabIndex={selected ? 0 : -1}
                className={`tab${selected ? " tab-active" : ""}`}
                onClick={() => onValueChange?.(item.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    selectAt((index + 1) % items.length);
                  } else if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    selectAt((index - 1 + items.length) % items.length);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    selectAt(0);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    selectAt(items.length - 1);
                  }
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
      {activeItem && (
        <div
          role="tabpanel"
          id={`${groupId}-panel`}
          aria-labelledby={`${groupId}-tab-${items.indexOf(activeItem)}`}
          className="focus-visible:outline-none"
        >
          {activeItem.content}
        </div>
      )}
    </>
  );
}
