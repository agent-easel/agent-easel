import type { ComponentProps, ReactNode } from "react";
import {
  CircleCheck,
  CircleDashed,
  CirclePause,
  CircleStop,
  Info,
  LoaderCircle,
  MessageCircleQuestionMark,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** The canonical Run and Block work states; each has its own label. */
export type RunStateKind =
  | "working"
  | "waiting"
  | "needs-input"
  | "problem"
  | "finished"
  | "stopped";

/** Setting and field states; the caller names the state ("Connected", "Install failed"). */
export type SettingKind = "success" | "attention" | "error" | "neutral" | "checking" | "info";

export type StatusBadgeKind = RunStateKind | SettingKind;

const tones = {
  working: "bg-status-working/16 text-status-working",
  waiting: "bg-status-waiting/16 text-status-waiting",
  "needs-input": "bg-attention/16 text-attention",
  problem: "bg-destructive/16 text-destructive",
  finished: "bg-success/16 text-success",
  stopped: "bg-status-stopped/16 text-muted-foreground",
  success: "bg-success/16 text-success",
  attention: "bg-attention/16 text-attention",
  error: "bg-destructive/16 text-destructive",
  neutral: "bg-status-stopped/16 text-muted-foreground",
  checking: "bg-status-stopped/16 text-muted-foreground",
  info: "bg-status-waiting/16 text-status-waiting",
} as const satisfies Record<StatusBadgeKind, string>;

const icons: Record<StatusBadgeKind, LucideIcon> = {
  working: LoaderCircle,
  waiting: CirclePause,
  "needs-input": MessageCircleQuestionMark,
  problem: TriangleAlert,
  finished: CircleCheck,
  stopped: CircleStop,
  success: CircleCheck,
  attention: TriangleAlert,
  error: TriangleAlert,
  neutral: CircleDashed,
  checking: LoaderCircle,
  info: Info,
};

/** The canonical label of each Run and Block work state. */
export const RUN_STATE_LABELS: Record<RunStateKind, string> = {
  working: "Working",
  waiting: "Waiting",
  "needs-input": "Needs input",
  problem: "Problem",
  finished: "Finished",
  stopped: "Stopped",
};

type StatusBadgeProps = Omit<ComponentProps<"span">, "children"> & {
  /** Replaces the kind's glyph where the meaning needs it (Unplug for Disconnected). */
  icon?: LucideIcon;
} & ({ kind: RunStateKind; children?: ReactNode } | { kind: SettingKind; children: ReactNode });

/**
 * The one status and field-state tag: an icon and a label in the state colour on its tint.
 * Context such as a Block name or a time sits outside the badge.
 */
export function StatusBadge({ kind, icon, children, className, ...props }: StatusBadgeProps) {
  const Icon = icon ?? icons[kind];
  return (
    <span
      data-slot="status-badge"
      data-kind={kind}
      className={cn(
        "inline-flex h-4.5 w-fit max-w-full shrink-0 items-center gap-1 rounded-sm pr-1.5 pl-1.25 text-2xs leading-none font-medium whitespace-nowrap",
        tones[kind],
        className,
      )}
      {...props}
    >
      <Icon aria-hidden strokeWidth={2} className="size-3 shrink-0" />
      <span className="truncate">{children ?? RUN_STATE_LABELS[kind as RunStateKind]}</span>
    </span>
  );
}
