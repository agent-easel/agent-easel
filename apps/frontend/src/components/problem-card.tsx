import type { ReactNode } from "react";
import { Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
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
