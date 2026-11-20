import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { CheckIcon, ChevronsUpDown } from "lucide-react";
import { Select } from "radix-ui";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./status-badge.tsx";
import { fieldAria, fieldBorder, type FieldState } from "./field-state.ts";
import { PickerMenuSearch, pickerShowsSearch } from "./picker-menu-search.tsx";
import { selectFieldClass } from "@/components/page";
import { cn } from "@/lib/utils";

export interface MenuChoice {
  readonly id: string;
  readonly label: string;
  /** Short marker shown next to the label, in the list and on the trigger; part of its name. */
  readonly badge?: string;
  /** The badge's tone; attention unless the marker only explains a disabled choice. */
  readonly badgeKind?: "attention" | "neutral" | "error";
  /** A line under the label, such as why the choice is limited or where it lives. */
  readonly description?: string;
  /** A glyph before the label in the list, such as a Project's icon. */
  readonly icon?: ReactNode;
  /** The group the choice is listed under; adjacent choices of one group share its heading. */
  readonly group?: MenuGroup;
  readonly disabled?: boolean;
}

/** A group of choices: its identity, and its heading, which another group may share. */
export interface MenuGroup {
  readonly id: string;
  readonly label: string;
}

/** What the trigger shows beside the chosen label. */
interface TriggerExtras {
  /** The trigger's name before its value when it differs from the field's, such as "Select Flow". */
  readonly label?: string;
  /** A glyph that always leads the trigger, such as the composer Flow pill's icon. */
  readonly glyph?: ReactNode;
  /** Visible words before the value, such as "Owner:". */
  readonly prefix?: string;
  /** The chosen choice's icon before its label. */
  readonly icon?: boolean;
  /** A quiet line after the label, such as where the choice lives. */
  readonly detail?: string;
  /**
   * The shown label and detail describe the trigger, for a field named by a visible label, whose
   * name leaves out the value.
   */
  readonly describesValue?: boolean;
}

/** The field's name: a label the trigger prefixes to its value, or the id of a visible label. */
type ChoiceName = { label: string; labelledBy?: never } | { labelledBy: string; label?: never };

/** A search pinned above a list of more than seven choices; it filters them by label. */
interface ChoiceSearch {
  /** The search field's name and placeholder, such as "Search Flows". */
  readonly label: string;
  /** What the list says when no choice matches. */
  readonly noMatch: string;
}

/**
 * A Run composer toolbar menu. It opens under the field, left-aligned, and stops at the space
 * below it: a long list scrolls, with a visible scrollbar and a fade over the row the cap cuts
 * off, instead of flipping up over the heading.
 */
interface ComposerMenu {
  readonly search: ChoiceSearch;
  /** A Start is pending: the trigger keeps focus and says so, but neither opens nor changes. */
  readonly busy: boolean;
  /** The choice the list checks, which may differ from the value; null checks none. */
  readonly checked: string | null;
}

/**
 * A single choice from a list: a select-only combobox whose list keeps unavailable choices
 * visible, unchoosable and explained. The trigger and the list carry the field's name.
 */
export function ChoiceMenu({
  id,
  label,
  labelledBy,
  value,
  choices,
  onChange,
  disabled,
  placeholder,
  unlistedLabel,
  empty,
  className,
  popupClassName,
  describedBy,
  problemTone = "attention",
  required,
  composer,
  trigger = {},
}: ChoiceName & {
  id: string;
  value: string;
  choices: readonly MenuChoice[];
  onChange: (value: string) => void;
  disabled: boolean;
  placeholder: string;
  /** What the trigger shows for a value that is not one of the choices. */
  unlistedLabel?: string | undefined;
  /** What the list says when there is nothing to choose. */
  empty?: string;
  /** Trigger size where the form is denser than the composer, such as a Settings row. */
  className?: string;
  /** List size where rows need more room than the trigger. */
  popupClassName?: string;
  describedBy?: string | undefined;
  /** The tone of the problem that `describedBy` names. */
  problemTone?: FieldState["tone"];
  /** The value must be chosen; the placeholder is never one of the choices. */
  required?: boolean;
  composer?: ComposerMenu;
  trigger?: TriggerExtras;
}) {
  const { listValue, selected, shown } = chosen(choices, value, composer?.checked, unlistedLabel);
  const names = choiceNames(
    label,
    labelledBy,
    trigger.label,
    `${shown ?? placeholder}${badgeSuffix(selected)}`,
  );
  const { listSearch, ...root } = useChoiceList({ choices, onChange, composer });
  const valueId = useId();
  const valueIds = trigger.describesValue
    ? [`${valueId}-label`, ...(trigger.detail ? [`${valueId}-detail`] : [])]
    : [];
  return (
    <Select.Root {...root} value={listValue} disabled={disabled}>
      <ChoiceTrigger
        id={id}
        name={names.trigger}
        required={required}
        busy={composer?.busy}
        dialog={!!listSearch || !choices.length}
        describedBy={describedBy}
        valueIds={valueIds}
        problemTone={problemTone}
        className={className}
      >
        <ChoiceValue
          id={trigger.describesValue ? valueId : undefined}
          shown={shown}
          placeholder={placeholder}
          selected={selected}
          extras={trigger}
        />
      </ChoiceTrigger>
      <ChoiceList
        name={names.list}
        choices={choices}
        listValue={listValue}
        empty={empty}
        className={popupClassName}
        opensDown={!!composer}
        search={listSearch}
      />
    </Select.Root>
  );
}

function ChoiceTrigger({
  id,
  name,
  required,
  busy,
  dialog,
  describedBy,
  valueIds,
  problemTone,
  className,
  children,
}: {
  id: string;
  name: ReturnType<typeof choiceNames>["trigger"];
  required: boolean | undefined;
  busy: boolean | undefined;
  dialog: boolean;
  describedBy: string | undefined;
  /** The shown value's elements, which describe the trigger before its problem. */
  valueIds: readonly string[];
  problemTone: FieldState["tone"];
  className: string | undefined;
  children: ReactNode;
}) {
  return (
    <Select.Trigger asChild>
      <Button
        type="button"
        id={id}
        variant="outline"
        {...name}
        // On the trigger only: Radix's own `required` would also make the hidden form select
        // block submission with the browser's message instead of the form's.
        aria-required={required}
        {...triggerState(busy, dialog)}
        {...fieldAria(describedBy)}
        aria-describedby={[...valueIds, describedBy].filter(Boolean).join(" ") || undefined}
        className={cn(
          selectFieldClass,
          "disabled:opacity-50 data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/30",
          className,
          fieldBorder(describedBy ? problemTone : undefined),
        )}
      >
        {children}
        <ChevronsUpDown
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.5}
        />
      </Button>
    </Select.Trigger>
  );
}

/**
 * Whether the list is open, its search, which is empty whenever the list opens or closes, and
 * choosing. A busy field neither opens nor changes, including by the closed trigger's typeahead.
 */
function useChoiceList({
  choices,
  onChange,
  composer,
}: {
  choices: readonly MenuChoice[];
  onChange: (value: string) => void;
  composer: ComposerMenu | undefined;
}) {
  const busy = composer?.busy;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const onOpenChange = (next: boolean) => {
    if (next && busy) return;
    setOpen(next);
    // The closed trigger's typeahead also skips the rows a search hides.
    setQuery("");
  };
  const onValueChange = (next: string) => {
    if (!busy) onChange(choices[Number(next)]!.id);
  };
  const listSearch =
    composer && pickerShowsSearch(choices.length)
      ? { ...composer.search, query, onQuery: setQuery }
      : undefined;
  return { open, onOpenChange, onValueChange, listSearch };
}

/**
 * A busy trigger is disabled for assistive technology only; with search or nothing to choose, the
 * popup is a dialog.
 */
const triggerState = (busy: boolean | undefined, dialog: boolean) => ({
  ...(busy && { "aria-disabled": true, "aria-busy": true }),
  ...(dialog && { "aria-haspopup": "dialog" as const }),
});

/**
 * The trigger's content: its prefix, the chosen icon, label, badge and detail, or the placeholder.
 * With an `id`, the label and detail carry ids derived from it.
 */
function ChoiceValue({
  id,
  shown,
  placeholder,
  selected,
  extras: { glyph, prefix, icon, detail },
}: {
  id: string | undefined;
  shown: string | undefined;
  placeholder: string;
  selected: MenuChoice | undefined;
  extras: TriggerExtras;
}) {
  return (
    <>
      {glyph}
      {prefix && <span className="shrink-0 text-subtle-foreground">{prefix}</span>}
      {icon && selected?.icon && <span className="flex shrink-0">{selected.icon}</span>}
      <span
        id={id && `${id}-label`}
        data-slot="choice-value"
        className={cn("min-w-0 truncate", !shown && "text-muted-foreground")}
      >
        {shown ?? placeholder}
      </span>
      {selected?.badge && (
        <StatusBadge kind={selected.badgeKind ?? "attention"}>{selected.badge}</StatusBadge>
      )}
      <TriggerDetail id={id && `${id}-detail`} detail={detail} />
    </>
  );
}

/** The detail fills the trigger's free width, truncated from its start so a path keeps its end. */
function TriggerDetail({ id, detail }: { id: string | undefined; detail: string | undefined }) {
  if (!detail) return <span className="flex-1" />;
  return (
    <span
      id={id}
      title={detail}
      dir="rtl"
      className="w-0 flex-1 truncate text-left text-2xs tracking-label text-subtle-foreground"
    >
      <bdi dir="ltr">{detail}</bdi>
    </span>
  );
}

type ListName = ReturnType<typeof choiceNames>["list"];

/**
 * The popup listbox, named like its field; with search, a dialog holding the search and the list.
 * While it shows no choice, the popup is a dialog that says why.
 */
function ChoiceList({
  name,
  choices,
  listValue,
  empty,
  className,
  opensDown,
  search,
}: {
  name: ListName;
  choices: readonly MenuChoice[];
  listValue: string;
  empty: string | undefined;
  className: string | undefined;
  opensDown: boolean;
  search: (ChoiceSearch & { query: string; onQuery: (query: string) => void }) | undefined;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const viewportRef = useCallback((node: HTMLDivElement | null) => {
    listRef.current = node;
    setViewport(node);
  }, []);
  const query = search?.query.trim().toLocaleLowerCase() ?? "";
  const matches = (choice: MenuChoice) => choice.label.toLocaleLowerCase().includes(query);
  const handlers = useSearchFocus(searchRef, listRef);
  const status = listStatus(choices, matches, empty, search?.noMatch);
  const statusId = useId();
  const parts = listParts(name, opensDown, !!search, status ? statusId : undefined);
  return (
    <Select.Portal>
      <Select.Content
        position="popper"
        side="bottom"
        sideOffset={4}
        {...parts.content}
        {...(search && handlers)}
        className={cn(parts.content.className, className)}
      >
        {search && (
          <PickerMenuSearch
            ariaLabel={search.label}
            placeholder={search.label}
            value={search.query}
            onChange={search.onQuery}
            inputRef={searchRef}
            listRef={listRef}
            firstChoiceSelector={firstShownChoice}
          />
        )}
        {/* Radix hides the list's scrollbar; a long list keeps it visible. */}
        <Select.Viewport ref={viewportRef} {...parts.list}>
          <ChoiceRows choices={choices} listValue={listValue} shows={matches} />
        </Select.Viewport>
        {/* Without search the popup is the listbox unless it is empty, which never changes
            while it is open, so the status mounts only to say why. */}
        {(search || status) && <ListStatus id={statusId} status={status} />}
        {opensDown && <ListFade viewport={viewport} watch={`${query}:${choices.length}`} />}
      </Select.Content>
    </Select.Portal>
  );
}

const popupClass =
  "relative z-50 max-h-(--radix-select-content-available-height) w-(--radix-select-trigger-width) max-w-[calc(100vw-1rem)] min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95";

/** Leaves a 12px gap above the window edge. */
const opensDownClass = "max-h-[calc(var(--radix-select-content-available-height)-12px)]";

/**
 * The popup and its list. Without search the popup is the named listbox; with search it is a
 * named dialog holding the search and the listbox. While no choice shows, which `statusId` says,
 * there is no listbox: a listbox must hold options, so the popup is a named dialog the status
 * describes.
 */
function listParts(
  name: ListName,
  opensDown: boolean,
  searching: boolean,
  statusId: string | undefined,
) {
  const content = {
    ...name,
    align: opensDown ? ("start" as const) : ("end" as const),
    avoidCollisions: !opensDown,
    className: cn(popupClass, opensDown && opensDownClass, searching && "p-0"),
  };
  const scrollbar = cn(
    "[scrollbar-width:thin]!",
    opensDown && "[scrollbar-color:var(--border-strong)_transparent]",
  );
  const list = { className: cn(scrollbar, searching && "p-1") };
  if (statusId)
    return {
      content: { ...content, role: "dialog", "aria-describedby": statusId },
      list: { ...list, role: "presentation" },
    };
  if (!searching) return { content, list };
  return { content: { ...content, role: "dialog" }, list: { ...list, ...name, role: "listbox" } };
}

/** Why the list shows no choice, if it shows none: nothing to choose, or nothing matches. */
function listStatus(
  choices: readonly MenuChoice[],
  matches: (choice: MenuChoice) => boolean,
  empty: string | undefined,
  noMatch: string | undefined,
) {
  if (!choices.length) return empty;
  return choices.some(matches) ? undefined : noMatch;
}

/** With search it stays mounted while the popup is open, so a search that stops matching is announced. */
function ListStatus({ id, status }: { id: string; status: string | undefined }) {
  return (
    <p id={id} role="status" className={cn(status && "px-3 py-2 text-sm text-muted-foreground")}>
      {status}
    </p>
  );
}

/** A fade over the row the height cap cuts off. */
function ListFade({ viewport, watch }: { viewport: HTMLElement | null; watch: string }) {
  if (!useCutOff(viewport, watch)) return null;
  return (
    <div
      aria-hidden
      data-slot="choice-menu-fade"
      className="pointer-events-none absolute right-2 bottom-0 left-0 h-8 bg-linear-to-t from-popover to-transparent"
    />
  );
}

const firstShownChoice = '[role="option"]:not([data-disabled]):not([hidden])';

/** Whether the list scrolls on past its bottom edge, so a row there is cut off. */
function useCutOff(viewport: HTMLElement | null, watch: string) {
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    if (!viewport) return;
    const update = () =>
      setCut(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 1);
    update();
    viewport.addEventListener("scroll", update);
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => {
      viewport.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [viewport, watch]);
  return !!viewport && cut;
}

/**
 * Keeps focus in the search until the person moves into the list: Radix focuses the checked
 * choice on open (after scrolling to it) and the list when the pointer leaves a choice, and a
 * hovered choice takes focus. ArrowUp on the first shown choice returns to the search.
 */
function useSearchFocus(
  searchRef: RefObject<HTMLInputElement | null>,
  listRef: RefObject<HTMLDivElement | null>,
) {
  const toSearch = () => searchRef.current?.focus();
  return {
    onFocusCapture: (event: FocusEvent<HTMLElement>) => {
      if (event.target === searchRef.current) return;
      const fromInside =
        event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget);
      if (event.target === event.currentTarget || !fromInside) toSearch();
    },
    onPointerMoveCapture: (event: PointerEvent<HTMLElement>) => {
      if (document.activeElement === searchRef.current) event.preventDefault();
    },
    onKeyDownCapture: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "ArrowUp") return;
      if (event.target !== listRef.current?.querySelector(firstShownChoice)) return;
      event.preventDefault();
      event.stopPropagation();
      toSearch();
    },
  };
}

/** The chosen choice, the list value it checks, and what the trigger shows for `value`. */
function chosen(
  choices: readonly MenuChoice[],
  value: string,
  checked: string | null | undefined,
  unlistedLabel: string | undefined,
) {
  // Radix reserves the empty value for "nothing chosen", which some choices use as their id.
  const index = (id: string | null) => choices.findIndex((choice) => choice.id === id);
  const selected = choices[index(value)];
  const listed = index(checked === undefined ? value : checked);
  return {
    listValue: listed < 0 ? "" : String(listed),
    selected,
    shown: selected?.label ?? (value ? unlistedLabel : undefined),
  };
}

/** The list is named like its field; a labelled trigger also reads out what it shows. */
function choiceNames(
  label: string | undefined,
  labelledBy: string | undefined,
  triggerLabel: string | undefined,
  shown: string,
) {
  if (labelledBy) {
    const name = { "aria-labelledby": labelledBy };
    return { list: name, trigger: name };
  }
  return {
    list: { "aria-label": label },
    trigger: { "aria-label": `${triggerLabel ?? label}: ${shown}` },
  };
}

const badgeSuffix = (choice: MenuChoice | undefined) => (choice?.badge ? `, ${choice.badge}` : "");

/** Runs of adjacent choices of one group; a choice's list value is its index. */
function groupChoices(choices: readonly MenuChoice[]) {
  return choices.reduce<
    { group: MenuGroup | undefined; rows: { choice: MenuChoice; at: number }[] }[]
  >((groups, choice, at) => {
    const last = groups.at(-1);
    if (last && last.group?.id === choice.group?.id) last.rows.push({ choice, at });
    else groups.push({ group: choice.group, rows: [{ choice, at }] });
    return groups;
  }, []);
}

/**
 * The list's rows. A search hides and disables the rows it does not match rather than removing
 * them: Radix moves focus to its checked row whenever that row mounts again, which would leave
 * the search, and its typeahead and arrow keys pass over disabled rows.
 */
function ChoiceRows({
  choices,
  listValue,
  shows,
}: {
  choices: readonly MenuChoice[];
  listValue: string;
  shows: (choice: MenuChoice) => boolean;
}) {
  const rowId = useId();
  const row = ({ choice, at }: { choice: MenuChoice; at: number }) => (
    <ChoiceRow
      key={choice.id}
      choice={choice}
      at={at}
      id={`${rowId}-${at}`}
      checked={String(at) === listValue}
      hidden={!shows(choice)}
    />
  );
  return groupChoices(choices).flatMap(({ group, rows }) =>
    group === undefined
      ? rows.map(row)
      : [
          <Select.Group
            key={`group-${rows[0]!.at}`}
            hidden={!rows.some(({ choice }) => shows(choice))}
          >
            <Select.Label className="px-2 pt-2 pb-1 text-xs font-medium text-subtle-foreground">
              {group.label}
            </Select.Label>
            {rows.map(row)}
          </Select.Group>,
        ],
  );
}

/**
 * One choice: its label and badge name it; its description describes it. A checked choice is
 * selected for assistive technology wherever focus is; Radix marks it only while it has focus.
 */
function ChoiceRow({
  choice,
  at,
  id,
  checked,
  hidden,
}: {
  choice: MenuChoice;
  at: number;
  id: string;
  checked: boolean;
  hidden: boolean;
}) {
  const labelId = `${id}-label`;
  const badgeId = `${id}-badge`;
  const descriptionId = `${id}-description`;
  return (
    <Select.Item
      value={String(at)}
      disabled={choice.disabled || hidden}
      hidden={hidden}
      aria-selected={checked}
      aria-labelledby={choice.badge ? `${labelId} ${badgeId}` : labelId}
      aria-describedby={choice.description ? descriptionId : undefined}
      className="relative my-0.5 flex cursor-default items-start gap-2 rounded-md py-2 pr-8 pl-3 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[state=checked]:bg-brand-soft [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
    >
      {choice.icon && <span className="mt-0.5 flex shrink-0">{choice.icon}</span>}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          {/* Wraps rather than truncates, so a long name keeps the ending that tells it apart.
              Radix's ItemText drops its className, so the wrapping is on this span. */}
          <span className="min-w-0 wrap-anywhere">
            <Select.ItemText id={labelId}>{choice.label}</Select.ItemText>
          </span>
          {choice.badge && (
            <StatusBadge id={badgeId} kind={choice.badgeKind ?? "attention"}>
              {choice.badge}
            </StatusBadge>
          )}
        </span>
        {choice.description && (
          <span id={descriptionId} className="text-2xs wrap-anywhere text-muted-foreground">
            {choice.description}
          </span>
        )}
      </span>
      <Select.ItemIndicator className="absolute top-1/2 right-3 flex size-3.5 -translate-y-1/2 items-center justify-center text-link">
        <CheckIcon className="size-3.5" />
      </Select.ItemIndicator>
    </Select.Item>
  );
}
