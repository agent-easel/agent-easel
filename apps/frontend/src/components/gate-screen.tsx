import { LocalApplicationControls } from "./desktop-app-settings.tsx";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { DesktopTitlebar } from "./desktop-titlebar.tsx";

const sizes = {
  default: {
    main: "bg-muted",
    card: "max-w-md gap-5 bg-background p-6",
    title: "text-lg",
  },
  // First-run setup: the wider card of a checklist, on the canvas like the Figma frames.
  wide: {
    main: "bg-background",
    card: "max-w-[560px] gap-5 bg-card p-7",
    title: "text-lg leading-normal",
  },
} as const;

/** Full-window state shown before the product is available: role, connection, access or setup. */
export function GateScreen({
  icon: Icon,
  eyebrow,
  title,
  description,
  children,
  label,
  size = "default",
}: {
  icon: LucideIcon;
  /** Names the product beside a small brand icon instead of the large state icon. */
  eyebrow?: string;
  title: string;
  description: ReactNode;
  children?: ReactNode;
  /** Accessible name of the screen region, also used by journeys. */
  label: string;
  size?: keyof typeof sizes;
}) {
  const classes = sizes[size];
  return (
    <main
      aria-label={label}
      className={cn("flex min-h-dvh items-center justify-center px-4 py-10", classes.main)}
    >
      <DesktopTitlebar floating />
      <section className={cn("grid w-full rounded-lg border shadow-sm", classes.card)}>
        <div className="grid gap-2">
          {eyebrow ? (
            <div className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
              <Icon aria-hidden strokeWidth={1.5} className="size-4 text-primary" />
              {eyebrow}
            </div>
          ) : (
            <Icon aria-hidden strokeWidth={1.5} className="size-6 text-muted-foreground" />
          )}
          <h1 className={cn("font-semibold tracking-tight", classes.title)}>{title}</h1>
          <div className="text-sm text-muted-foreground">{description}</div>
        </div>
        {children}
        <LocalApplicationControls />
      </section>
    </main>
  );
}
