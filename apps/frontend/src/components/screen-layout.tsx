import { useEffect, useRef, useState, type ReactNode } from "react";
import { PageTopBar } from "./page.tsx";

/** Full-height workspace shared by the authoring and execution canvases. */
export function CanvasLayout({ children }: { children: ReactNode }) {
  return <main className="flex h-full min-h-140 flex-col">{children}</main>;
}

/** Scrolling page with the common compact application top bar. */
export function ScreenLayout({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <PageTopBar>{title}</PageTopBar>
      {children}
    </div>
  );
}

export function SettingsPanel({ children }: { children: ReactNode }) {
  const pane = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!end.current) return;
    const observer = new IntersectionObserver(([entry]) => setMore(!entry?.isIntersecting), {
      root: pane.current,
    });
    observer.observe(end.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative min-h-0 min-w-0 flex-1">
      <div
        ref={pane}
        className="h-full overflow-y-auto pt-6 pr-6 pl-8 [scrollbar-gutter:stable] max-sm:pr-2 max-sm:pl-4 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-subtle-foreground [&::-webkit-scrollbar-thumb]:bg-clip-padding"
      >
        {children}
        <div ref={end} aria-hidden className="mt-8 h-px" />
      </div>
      {more && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 mr-2 h-8 bg-linear-to-t from-background to-transparent"
        />
      )}
    </div>
  );
}
