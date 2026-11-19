import type { ComponentProps, ReactNode } from "react";
import { ChevronRight, ExternalLink, type LucideIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SettingsLink, StudioLink } from "./app-link.tsx";
import { cn } from "@/lib/utils";

type NoticeTone = "critical" | "attention" | "info" | "neutral";

/**
 * Figma launch / connection notice: toned icon, title, body and one follow-up action.
 * The icon and title carry the meaning, so tone never relies on color alone.
 */
export function Notice({
  id,
  tone,
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  id?: string;
  tone: NoticeTone;
  icon: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    // Run/InlineAlert geometry: 12 × 10 padding, 10 px icon gap, 4 px rows, 12.5 px text at normal leading.
    <Alert
      id={id}
      variant={tone}
      className={cn(
        "gap-y-1 px-3 py-2.5 leading-[normal] has-[>svg]:gap-x-2.5 [&>svg]:translate-y-0",
        className,
      )}
    >
      <Icon aria-hidden strokeWidth={1.5} />
      <AlertTitle className="min-h-0">{title}</AlertTitle>
      {(children || action) && (
        <AlertDescription className="gap-1 [&_p]:leading-[normal] [&>:not(p)]:pt-0.5">
          {children && <p>{children}</p>}
          {action}
        </AlertDescription>
      )}
    </Alert>
  );
}

const actionClass =
  "inline-flex items-center gap-1 rounded-sm font-medium text-link underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Settings link action for a notice, with the trailing chevron from the Figma notices. */
export function NoticeSettingsLink({ children, ...props }: ComponentProps<typeof SettingsLink>) {
  return (
    <SettingsLink {...props} className={actionClass}>
      {children}
      <ChevronRight aria-hidden className="size-3.5" strokeWidth={1.5} />
    </SettingsLink>
  );
}

/** Button action for a notice that acts in place (recheck, retry). */
export function NoticeButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(actionClass, "disabled:opacity-50")}
    >
      {children}
      <ChevronRight aria-hidden className="size-3.5" strokeWidth={1.5} />
    </button>
  );
}

/** Leaves Factory. The composer uses this only to open T3, and Factory takes no action there. */
export function NoticeExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={actionClass}>
      {children}
      <ExternalLink aria-hidden className="size-3.5" strokeWidth={1.5} />
    </a>
  );
}

export function NoticeStudioLink({ children, ...props }: ComponentProps<typeof StudioLink>) {
  return (
    <StudioLink {...props} className={actionClass}>
      {children}
      <ChevronRight aria-hidden className="size-3.5" strokeWidth={1.5} />
    </StudioLink>
  );
}
