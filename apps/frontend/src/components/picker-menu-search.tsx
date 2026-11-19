import {
  useCallback,
  useLayoutEffect,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { SearchIcon } from "lucide-react";
import { DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Search appears only once a menu lists more choices than fit without it. */
const pickerSearchMinimum = 7;

export function pickerShowsSearch(count: number) {
  return count > pickerSearchMinimum;
}

const enabledRadio = '[role="menuitemradio"]:not([data-disabled])';

export function PickerMenuSearch({
  ariaLabel,
  placeholder,
  value,
  onChange,
  inputRef,
  listRef,
  firstChoiceSelector,
}: {
  ariaLabel: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  firstChoiceSelector: string;
}) {
  return (
    <div className="shrink-0 border-b p-1">
      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute top-[9px] left-2.5 size-3.5 text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={inputRef}
          type="search"
          aria-label={ariaLabel}
          placeholder={placeholder}
          value={value}
          // muted-foreground clears 4.5:1 on the field; the tertiary placeholder color does not.
          className="h-8 bg-muted pl-8 placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-0"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") return;
            event.stopPropagation();
            if (event.key === "Enter") event.preventDefault();
            if (event.key !== "ArrowDown") return;
            event.preventDefault();
            const choice =
              listRef.current?.querySelector<HTMLElement>(firstChoiceSelector) ??
              listRef.current?.querySelector<HTMLElement>(enabledRadio);
            choice?.focus();
          }}
        />
      </div>
    </div>
  );
}

function usePickerMenuContentHandlers({
  searchRef,
  listRef,
  searchEnabled,
}: {
  searchRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  searchEnabled: boolean;
}) {
  const onFocusCapture = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      if (!searchEnabled || event.target !== event.currentTarget) return;
      event.preventDefault();
      event.stopPropagation();
      searchRef.current?.focus();
    },
    [searchEnabled, searchRef],
  );
  const onPointerMoveCapture = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (document.activeElement === searchRef.current) event.preventDefault();
    },
    [searchRef],
  );
  const onKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!searchEnabled || event.key !== "ArrowUp") return;
      const first = listRef.current?.querySelector(enabledRadio);
      if (event.target !== first) return;
      event.preventDefault();
      event.stopPropagation();
      searchRef.current?.focus();
    },
    [listRef, searchEnabled, searchRef],
  );
  return { onFocusCapture, onPointerMoveCapture, onKeyDownCapture };
}

/**
 * Opens under the field and stops at the space below it, so a long menu scrolls instead of
 * flipping up over the heading.
 */
export function PickerMenuContent({
  className,
  searchRef,
  listRef,
  searchEnabled,
  children,
}: {
  className?: string;
  searchRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  searchEnabled: boolean;
  children: ReactNode;
}) {
  const menuHandlers = usePickerMenuContentHandlers({ searchRef, listRef, searchEnabled });
  return (
    <DropdownMenuContent
      side="bottom"
      avoidCollisions={false}
      align="start"
      // Tracks the popper as the anchor moves, and leaves a 12px gap above the window edge.
      style={{ maxHeight: "calc(var(--radix-dropdown-menu-content-available-height) - 12px)" }}
      className={cn("flex w-80 max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0", className)}
      {...menuHandlers}
    >
      {children}
    </DropdownMenuContent>
  );
}

/** The scrolling choice list: a visible scrollbar, and a fade over the row the cap cuts off. */
export function PickerMenuList({
  listRef,
  label,
  watch,
  children,
}: {
  listRef: RefObject<HTMLDivElement | null>;
  label: string;
  watch: string;
  children: ReactNode;
}) {
  const [cut, setCut] = useState(false);
  const updateCut = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const overflowing = list.scrollHeight - list.scrollTop - list.clientHeight > 1;
    setCut((current) => (current === overflowing ? current : overflowing));
  }, [listRef]);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const fit = () => {
      const content = list.closest("[data-slot='dropdown-menu-content']");
      if (content instanceof HTMLElement) {
        const cap = Number.parseFloat(getComputedStyle(content).maxHeight);
        if (Number.isFinite(cap)) {
          const pinned = [...content.children].reduce((sum, child) => {
            if (!(child instanceof HTMLElement) || child.contains(list)) return sum;
            return sum + child.offsetHeight;
          }, 0);
          const frame = content.offsetHeight - content.clientHeight;
          const next = `${Math.max(0, cap - pinned - frame)}px`;
          if (list.style.maxHeight !== next) list.style.maxHeight = next;
        }
      }
      updateCut();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(list);
    const content = list.closest("[data-slot='dropdown-menu-content']");
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [listRef, updateCut, watch]);
  return (
    <div className="relative min-h-0">
      <div
        ref={listRef}
        role="group"
        aria-label={label}
        onScroll={updateCut}
        className="min-h-0 overflow-y-auto overscroll-contain p-1 [scrollbar-color:var(--border-strong)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-strong"
      >
        {children}
      </div>
      {cut && (
        <div
          aria-hidden
          data-slot="picker-menu-fade"
          className="pointer-events-none absolute bottom-0 left-0 h-8 w-[calc(100%-0.5rem)] bg-linear-to-t from-popover to-transparent"
        />
      )}
    </div>
  );
}
