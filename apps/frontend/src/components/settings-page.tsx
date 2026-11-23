import { useId, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { StatusBadge } from "./status-badge.tsx";
import { cn } from "@/lib/utils";
import { Surface } from "@/components/ui/surface";
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
  description,
  children,
}: {
  label: string;
  /** A status badge shown after the label. */
  badge?: ReactNode;
  description?: ReactNode;
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
      {description && <p className="pl-0.5 text-sm text-muted-foreground">{description}</p>}
      <Surface tone="group">{children}</Surface>
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
