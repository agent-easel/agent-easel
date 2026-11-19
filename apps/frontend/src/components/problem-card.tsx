import type { ComponentProps, ReactNode } from "react";
import { ChevronRight, ExternalLink, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { SettingsLink, StudioLink } from "./app-link.tsx";
import type { SettingKind } from "./status-badge.tsx";
import { TechnicalDetails, type TechnicalDetail } from "./technical-details.tsx";

/** The card tones are the status badge's Setting kinds, so a field tag and its card agree. */
export type ProblemTone = Extract<SettingKind, "error" | "attention" | "info" | "neutral">;

const density = {
  // Figma settings and Studio cards: 16 × 12 padding, 12 px icon gap, relaxed body.
  default: {
    root: "",
    title: "",
    description: "gap-2",
  },
  // Figma Run/InlineAlert (composer, Run page, dialogs): 12 × 10 padding, 10 px icon gap, 4 px
  // rows, text at normal leading.
  compact: {
    root: "gap-y-1 px-3 py-2.5 leading-[normal] has-[>svg]:gap-x-2.5 [&>svg]:translate-y-0",
    title: "min-h-0",
    description: "gap-1 [&_p]:leading-[normal] [&>:not(p)]:pt-0.5",
  },
} as const;

/**
 * The one problem, notice and explanation card: a toned icon, its title, an optional body, one
 * next step and closed Technical details. The icon and title carry the meaning, so tone never
 * relies on color alone. An error is an `alert`; every other tone is a `status`.
 */
export function ProblemCard({
  id,
  label,
  tone,
  density: size = "default",
  icon,
  title,
  children,
  action,
  details,
  className,
}: {
  /** Lets a field point at this card with `aria-describedby`. */
  id?: string;
  /** Names the card's live region where its title alone is ambiguous on the page. */
  label?: string;
  tone: ProblemTone;
  density?: keyof typeof density;
  /** Replaces the tone's glyph where the meaning needs it (CloudOff for Factory offline). */
  icon?: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  details?: string | readonly TechnicalDetail[] | undefined;
  className?: string;
}) {
  const Icon = icon ?? (tone === "error" || tone === "attention" ? TriangleAlert : Info);
  const classes = density[size];
  return (
    <Alert
      id={id}
      aria-label={label}
      variant={tone}
      role={tone === "error" ? "alert" : "status"}
      className={cn(classes.root, className)}
    >
      <Icon aria-hidden strokeWidth={1.5} />
      <AlertTitle className={classes.title}>{title}</AlertTitle>
      {(children || action || details) && (
        <AlertDescription className={cn("min-w-0 justify-items-stretch", classes.description)}>
          {children && <p>{children}</p>}
          {action && <div>{action}</div>}
          {details && <TechnicalDetails details={details} />}
        </AlertDescription>
      )}
    </Alert>
  );
}

const actionClass =
  "inline-flex items-center gap-1 rounded-sm font-medium text-link underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50";

const chevron = <ChevronRight aria-hidden className="size-3.5" strokeWidth={1.5} />;

/** A card's next step that acts in place, such as Check again or Copy as JSON. */
export function ProblemCardButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean | undefined;
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
      {chevron}
    </button>
  );
}

/** A card's next step in Settings. */
export function ProblemCardSettingsLink({
  children,
  ...props
}: ComponentProps<typeof SettingsLink>) {
  return (
    <SettingsLink {...props} className={actionClass}>
      {children}
      {chevron}
    </SettingsLink>
  );
}

/** A card's next step in Studio. */
export function ProblemCardStudioLink({ children, ...props }: ComponentProps<typeof StudioLink>) {
  return (
    <StudioLink {...props} className={actionClass}>
      {children}
      {chevron}
    </StudioLink>
  );
}

/** Leaves Factory. The composer uses this only to open T3, and Factory takes no action there. */
export function ProblemCardExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={actionClass}>
      {children}
      <ExternalLink aria-hidden className="size-3.5" strokeWidth={1.5} />
    </a>
  );
}
