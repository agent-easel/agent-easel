import { useId, type ReactNode } from "react";
import { ChevronRight, Info, Lock, TriangleAlert, type LucideIcon } from "lucide-react";
import { StatusBadge } from "./status-badge.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button.tsx";

/**
 * Figma Settings v2 page template: every Settings section is one header followed by groups of
 * row cards and optional disclosures. These blocks are presentational; pages own the data.
 */
export function SettingsPage({
  title,
  leading,
  badge,
  hostManaged = false,
  action,
  children,
}: {
  title: string;
  leading?: ReactNode;
  /** A status badge shown after the title. */
  badge?: ReactNode;
  /** Shows the "Managed on the Factory host" chip on clients that cannot change the page. */
  hostManaged?: boolean;
  /** Trailing page actions, ordered from secondary to primary. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-5">
      <header>
        <div className="flex min-h-8 flex-wrap items-center gap-2.5">
          {leading}
          <h2 className="min-w-0 truncate text-lg leading-tight font-semibold text-foreground">
            {title}
          </h2>
          {badge}
          {hostManaged && (
            <StatusBadge kind="neutral" icon={Lock}>
              Managed on the Factory host
            </StatusBadge>
          )}
          {action && <div className="ml-auto flex flex-wrap items-center gap-2">{action}</div>}
        </div>
      </header>
      {children}
    </div>
  );
}

/** A labelled card of rows; the label is the group's heading and region name. */
export function SettingsGroup({
  label,
  badge,
  children,
}: {
  label: string;
  /** A status badge shown after the label. */
  badge?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-2">
      <div className="flex min-h-4.5 items-center gap-2 pl-0.5">
        <h3 id={id} className="text-sm font-medium text-muted-foreground">
          {label}
        </h3>
        {badge}
      </div>
      <div className="divide-y overflow-hidden rounded-lg border bg-muted">{children}</div>
    </section>
  );
}

/** Element ids of a row's text, for naming and describing its control. */
type SettingsRowText = { title: string; description: string | undefined };

/**
 * A setting: title, optional description and one trailing control. Pass the control as a
 * function to name it by the row's text, as a switch needs (`aria-labelledby={text.title}`).
 */
export function SettingsRow({
  title,
  description,
  control,
}: {
  title?: ReactNode;
  description?: ReactNode;
  control?: ReactNode | ((text: SettingsRowText) => ReactNode);
}) {
  const id = useId();
  const text: SettingsRowText = {
    title: `${id}-title`,
    description: description ? `${id}-description` : undefined,
  };
  return (
    <div
      className={cn(
        "flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 px-4",
        description ? "py-2.5" : "py-1.5",
      )}
    >
      <div className="grid min-w-32 flex-1 gap-0.5 text-sm leading-tight">
        {title && (
          <div id={text.title} className="font-medium text-foreground">
            {title}
          </div>
        )}
        {description && (
          <div id={text.description} className="text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {control && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {typeof control === "function" ? control(text) : control}
        </div>
      )}
    </div>
  );
}

/** A read-only fact: label and value, optionally monospaced, copyable or with one action. */
export function SettingsDetailRow({
  label,
  value,
  mono = false,
  copy,
  action,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  /** Text the copy button puts on the clipboard; omit for no copy button. */
  copy?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-3 px-4 py-1.5 text-sm leading-tight">
      <span className="w-37.5 shrink-0 max-sm:w-24 text-muted-foreground">{label}</span>
      <div
        className={cn(
          "min-w-0 flex-1 wrap-anywhere text-foreground",
          mono && "font-mono text-label",
        )}
      >
        {value}
      </div>
      {copy !== undefined && <CopyButton text={copy} label={`Copy ${label}`} />}
      {action}
    </div>
  );
}

/** Closed-by-default detail such as "How it works" or "Diagnostics", with a one-line hint. */
function SettingsDisclosure({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Collapsible className="grid gap-3">
      <CollapsibleTrigger className="group flex w-fit flex-wrap items-center gap-x-1.5 rounded-sm text-left text-sm leading-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <ChevronRight
          aria-hidden
          strokeWidth={1.5}
          className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
        />
        <span className="font-medium text-muted-foreground">{label}</span>
        {hint && <span className="text-subtle-foreground">{hint}</span>}
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-3 pl-5 text-sm text-muted-foreground">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Raw diagnostics are collapsed by default and copied as a single block. */
export function SettingsTechnicalDetails({ details }: { details: string }) {
  return (
    <SettingsDisclosure label="Technical details">
      <pre className="min-w-0 font-mono text-label wrap-anywhere whitespace-pre-wrap">
        {details}
      </pre>
      <CopyButton text={details} label="Copy details" showLabel />
    </SettingsDisclosure>
  );
}

/** One explanation and next step for a Settings problem. */
export function SettingsProblemCard({
  id,
  tone,
  title,
  children,
  details,
  action,
  icon,
}: {
  id?: string;
  tone: "error" | "warning" | "info";
  title: ReactNode;
  children?: ReactNode;
  details?: string | undefined;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  const Icon = icon ?? (tone === "info" ? Info : TriangleAlert);
  const variant = tone === "error" ? "critical" : tone === "warning" ? "attention" : "info";
  return (
    <Alert id={id} variant={variant} role={tone === "error" ? "alert" : "status"}>
      <Icon aria-hidden strokeWidth={1.5} />
      <AlertTitle>{title}</AlertTitle>
      {(children || details || action) && (
        <AlertDescription className="min-w-0 justify-items-stretch gap-2">
          {children && <p>{children}</p>}
          {action && <div>{action}</div>}
          {details && <SettingsTechnicalDetails details={details} />}
        </AlertDescription>
      )}
    </Alert>
  );
}

/** The heading and introduction used in Studio Trigger views. */
export function StudioPage({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-5">
      <header className="grid gap-1.5">
        <div className="flex min-h-8 items-center justify-between gap-2">
          <h2 className="text-lg leading-tight font-semibold">{title}</h2>
          {action}
        </div>
        <p className="text-sm leading-tight text-muted-foreground">{description}</p>
      </header>
      {children}
    </div>
  );
}
