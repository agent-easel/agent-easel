import { useLayoutEffect, useRef, useState } from "react";
import { menuLabel } from "../menu-label.ts";
import { cn } from "../lib/utils.ts";

let canvas: HTMLCanvasElement | undefined;

function measureFont(font: string) {
  return (text: string) => {
    canvas ??= document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return text.length;
    context.font = font;
    return context.measureText(text).width;
  };
}

/**
 * A menu row's name. The tooltip stays the full name; the visible text truncates at the end,
 * or in the middle when two rows would otherwise look the same. The row's accessible name
 * is the full name, set by the menu item.
 */
export function MenuName({
  name,
  peers,
  className,
}: {
  name: string;
  peers: readonly string[];
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(name);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const apply = () => {
      const width = Math.max(0, node.clientWidth - 4);
      const next = menuLabel(name, peers, width, measureFont(getComputedStyle(node).font));
      setShown((current) => (current === next ? current : next));
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => observer.disconnect();
  }, [name, peers]);
  return (
    <span ref={ref} className={cn("block min-w-0 flex-1 truncate", className)} title={name}>
      {shown}
    </span>
  );
}
