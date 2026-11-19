import { MutationGate } from "@/client-gate";
import { Ellipsis, Search } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";
import type { StudioSelection } from "../settings-navigation.ts";
import { relativeDay } from "../time-format.ts";
import { StudioLink } from "./app-link.tsx";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** The page padding and the gap under the toolbar, shared so the three lists line up. */
export const studioListClass = "grid content-start gap-5 px-8 pt-6 pb-8 max-sm:px-4";

export function StudioListHeader({
  title,
  count,
  query,
  onQueryChange,
  onCreate,
  createLabel,
  createVariant = "default",
  importer,
  filter,
}: {
  title: string;
  /** The total loaded count. Hidden while the list is still loading. */
  count: number | null;
  query: string;
  onQueryChange: (query: string) => void;
  onCreate: () => void;
  createLabel: string;
  /** Outline while a draft's own primary action is the one to use. */
  createVariant?: "default" | "outline";
  /** Import, on Flows and Agents. Triggers omit it. */
  importer?: ReactNode;
  /** The owner filter. Triggers omit it, so Search stays at the same left edge. */
  filter?: ReactNode;
}) {
  return (
    <div className="grid gap-5">
      <div className="flex min-h-8 items-center gap-2.5">
        <h1 className="text-xl font-semibold">{title}</h1>
        {count !== null && (
          <span className="rounded-full border bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">
            {count}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {importer}
          <MutationGate>
            <Button type="button" variant={createVariant} onClick={onCreate}>
              {createLabel}
            </Button>
          </MutationGate>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative w-70 shrink-0">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-[9px] left-2.5 size-3.5 text-subtle-foreground"
            strokeWidth={1.5}
          />
          <Input
            aria-label={`Search ${title}`}
            placeholder={`Search ${title}`}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="h-8 bg-muted pl-8"
          />
        </div>
        {filter}
      </div>
    </div>
  );
}

/** Loading, no-match, or the one load-failure line. Only the failure uses the error tone. */
export function StudioListMessage({
  tone,
  children,
}: {
  tone: "muted" | "error";
  children: string;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn("text-sm", tone === "error" ? "text-destructive" : "text-muted-foreground")}
    >
      {children}
    </p>
  );
}

/**
 * The one line under a list toolbar: the load failure, the loading line, no match, or the empty
 * list. Anything else is the grouped rows.
 */
export function StudioListBody({
  error,
  loaded,
  noMatch,
  empty,
  errorText,
  loadingText,
  noMatchText,
  emptyIcon,
  emptyTitle,
  children,
}: {
  error: boolean;
  loaded: boolean;
  noMatch: boolean;
  empty: boolean;
  errorText: string;
  loadingText: string;
  noMatchText: string;
  emptyIcon: ReactNode;
  emptyTitle: string;
  children: ReactNode;
}) {
  if (error) return <StudioListMessage tone="error">{errorText}</StudioListMessage>;
  if (!loaded) return <StudioListMessage tone="muted">{loadingText}</StudioListMessage>;
  if (noMatch) return <StudioListMessage tone="muted">{noMatchText}</StudioListMessage>;
  if (empty) return <StudioListEmpty icon={emptyIcon} title={emptyTitle} />;
  return children;
}

/** An empty list: the icon and the title, across the full width. */
export function StudioListEmpty({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <section className="flex min-h-80 flex-col items-center justify-center px-6 py-16 text-center">
      <span className="mb-4 text-subtle-foreground">{icon}</span>
      <h2 className="text-title font-semibold">{title}</h2>
    </section>
  );
}

/** One Studio list row. A `selection` opens that page; without one the row stays put. */
export function StudioListRow({
  icon,
  name,
  meta,
  metaAction,
  reason,
  badge,
  trailing,
  menu,
  selection,
  selected,
  chevron,
  control,
  wrap,
}: {
  icon: ReactNode;
  name: string;
  meta: ReactNode;
  /** Interactive content in the summary line, above the stretched row link. */
  metaAction?: ReactNode;
  reason?: ReactNode | undefined;
  badge?: ReactNode | undefined;
  trailing?: ReactNode | undefined;
  menu: ReactNode;
  selection?: StudioSelection | undefined;
  selected?: boolean | undefined;
  chevron?: ReactNode | undefined;
  /** A control before the ⋯ menu, such as a Trigger's switch. It sits above the row link. */
  control?: ReactNode | undefined;
  /** Agent names and summaries wrap. Other lists keep one line. */
  wrap?: boolean | undefined;
}) {
  const titleSelection = metaAction ? selection : undefined;
  const rowSelection = metaAction ? undefined : selection;
  const body = (
    <>
      {icon}
      <StudioRowText
        name={name}
        meta={metaAction ?? meta}
        reason={reason}
        wrap={wrap}
        selection={titleSelection}
        selected={selected}
      />
      {badge}
      {trailing}
    </>
  );
  const content = rowSelection ? (
    <StudioLink
      selection={rowSelection}
      aria-current={selected ? "page" : undefined}
      className={cn("flex min-w-0 flex-1 items-center gap-3", studioRowLinkClass)}
    >
      {body}
    </StudioLink>
  ) : (
    <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>
  );
  return (
    <div
      className={cn(
        "relative flex min-h-[58px] w-full items-center gap-3 rounded-lg border bg-muted px-4 py-1.5 text-left text-foreground transition-colors hover:border-border-hover hover:bg-accent",
        selected && "border-primary bg-sidebar-accent",
      )}
    >
      {content}
      {control && <div className="relative z-10 shrink-0">{control}</div>}
      <div className="relative z-10 shrink-0">{menu}</div>
      {chevron}
    </div>
  );
}

const studioRowLinkClass = "text-foreground after:absolute after:inset-0 hover:no-underline";

function StudioRowText({
  name,
  meta,
  reason,
  wrap,
  selection,
  selected,
}: {
  name: string;
  meta: ReactNode;
  reason: ReactNode;
  wrap: boolean | undefined;
  selection: StudioSelection | undefined;
  selected: boolean | undefined;
}) {
  const text = wrap ? "break-words" : "truncate";
  const titleClass = cn("text-sm leading-[normal] font-medium", text);
  return (
    <span className="grid min-w-0 flex-1 gap-[3px] leading-[normal]">
      {selection ? (
        <StudioLink
          selection={selection}
          aria-current={selected ? "page" : undefined}
          className={cn(titleClass, studioRowLinkClass)}
        >
          {name}
        </StudioLink>
      ) : (
        <span className={titleClass}>{name}</span>
      )}
      <span className={cn("text-2xs leading-[normal] text-subtle-foreground", text)}>{meta}</span>
      {reason && (
        <span className="text-xs leading-[normal] break-words text-muted-foreground">{reason}</span>
      )}
    </span>
  );
}

/** The row's always-visible ⋯ menu. `label` is its accessible name. */
export function StudioRowMenu({
  label,
  tooltip,
  buttonRef,
  children,
}: {
  label: string;
  tooltip: string;
  /** Where Remove returns focus, when the dialog asks for its opener. */
  buttonRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              ref={buttonRef}
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 text-muted-foreground"
              aria-label={label}
            >
              <Ellipsis aria-hidden className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-40">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The icon tile every list row starts with. */
export function StudioRowIcon({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-muted-foreground">
      {children}
    </span>
  );
}

export const editedLabel = (updatedAt: string) => `Edited ${relativeDay(updatedAt)}`;
