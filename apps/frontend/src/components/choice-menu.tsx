import { useId, type ReactNode } from "react";
import { CheckIcon, ChevronsUpDown } from "lucide-react";
import { Select } from "radix-ui";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./status-badge.tsx";
import { fieldAria, fieldBorder, type FieldState } from "./field-state.ts";
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
  /** The heading the choice is listed under; adjacent choices of one group share it. */
  readonly group?: string;
  readonly disabled?: boolean;
}

/** The field's name: a label the trigger prefixes to its value, or the id of a visible label. */
type ChoiceName = { label: string; labelledBy?: never } | { labelledBy: string; label?: never };

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
}) {
  const { listValue, selected, shown } = chosen(choices, value, unlistedLabel);
  const names = choiceNames(label, labelledBy, `${shown ?? placeholder}${badgeSuffix(selected)}`);
  return (
    <Select.Root
      value={listValue}
      onValueChange={(next) => onChange(choices[Number(next)]!.id)}
      disabled={disabled}
    >
      <Select.Trigger asChild>
        <Button
          type="button"
          id={id}
          variant="outline"
          {...names.trigger}
          // On the trigger only: Radix's own `required` would also make the hidden form select
          // block submission with the browser's message instead of the form's.
          aria-required={required}
          {...fieldAria(describedBy)}
          className={cn(
            selectFieldClass,
            "disabled:opacity-50 data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/30",
            className,
            fieldBorder(describedBy ? problemTone : undefined),
          )}
        >
          <ChoiceValue shown={shown} placeholder={placeholder} selected={selected} />
          <ChevronsUpDown
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.5}
          />
        </Button>
      </Select.Trigger>
      <ChoiceList name={names.list} choices={choices} empty={empty} className={popupClassName} />
    </Select.Root>
  );
}

/** The trigger's text: the chosen label and its badge, or the placeholder. */
function ChoiceValue({
  shown,
  placeholder,
  selected,
}: {
  shown: string | undefined;
  placeholder: string;
  selected: MenuChoice | undefined;
}) {
  return (
    <>
      <span className={cn("min-w-0 truncate", !shown && "text-muted-foreground")}>
        {shown ?? placeholder}
      </span>
      {selected?.badge && (
        <StatusBadge kind={selected.badgeKind ?? "attention"}>{selected.badge}</StatusBadge>
      )}
      <span className="flex-1" />
    </>
  );
}

/** The popup listbox, named like its field. */
function ChoiceList({
  name,
  choices,
  empty,
  className,
}: {
  name: ReturnType<typeof choiceNames>["list"];
  choices: readonly MenuChoice[];
  empty: string | undefined;
  className: string | undefined;
}) {
  return (
    <Select.Portal>
      <Select.Content
        position="popper"
        align="end"
        sideOffset={4}
        {...name}
        className={cn(
          "z-50 max-h-(--radix-select-content-available-height) w-(--radix-select-trigger-width) max-w-[calc(100vw-1rem)] min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
      >
        {/* Radix hides the list's scrollbar; a long list keeps it visible. */}
        <Select.Viewport className="[scrollbar-width:thin]!">
          <ChoiceRows choices={choices} />
          {!choices.length && empty && (
            <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
              {empty}
            </p>
          )}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  );
}

/** The chosen choice, its list value, and what the trigger shows for `value`. */
function chosen(choices: readonly MenuChoice[], value: string, unlistedLabel: string | undefined) {
  // Radix reserves the empty value for "nothing chosen", which some choices use as their id.
  const index = choices.findIndex((choice) => choice.id === value);
  const selected = choices[index];
  return {
    listValue: selected ? String(index) : "",
    selected,
    shown: selected?.label ?? (value ? unlistedLabel : undefined),
  };
}

/** The list is named like its field; a labelled trigger also reads out what it shows. */
function choiceNames(label: string | undefined, labelledBy: string | undefined, shown: string) {
  if (labelledBy) {
    const name = { "aria-labelledby": labelledBy };
    return { list: name, trigger: name };
  }
  return { list: { "aria-label": label }, trigger: { "aria-label": `${label}: ${shown}` } };
}

const badgeSuffix = (choice: MenuChoice | undefined) => (choice?.badge ? `, ${choice.badge}` : "");

/** Runs of adjacent choices that share a group; a choice's list value is its index. */
function groupChoices(choices: readonly MenuChoice[]) {
  return choices.reduce<
    { title: string | undefined; rows: { choice: MenuChoice; at: number }[] }[]
  >((groups, choice, at) => {
    const last = groups.at(-1);
    if (last && last.title === choice.group) last.rows.push({ choice, at });
    else groups.push({ title: choice.group, rows: [{ choice, at }] });
    return groups;
  }, []);
}

function ChoiceRows({ choices }: { choices: readonly MenuChoice[] }) {
  const rowId = useId();
  const row = ({ choice, at }: { choice: MenuChoice; at: number }) => (
    <ChoiceRow key={choice.id} choice={choice} at={at} id={`${rowId}-${at}`} />
  );
  return groupChoices(choices).flatMap(({ title, rows }) =>
    title === undefined
      ? rows.map(row)
      : [
          <Select.Group key={`group-${rows[0]!.at}`}>
            <Select.Label className="px-2 pt-2 pb-1 text-xs font-medium text-subtle-foreground">
              {title}
            </Select.Label>
            {rows.map(row)}
          </Select.Group>,
        ],
  );
}

/** One choice: its label and badge name it; its description describes it. */
function ChoiceRow({ choice, at, id }: { choice: MenuChoice; at: number; id: string }) {
  const labelId = `${id}-label`;
  const badgeId = `${id}-badge`;
  const descriptionId = `${id}-description`;
  return (
    <Select.Item
      value={String(at)}
      disabled={choice.disabled}
      aria-labelledby={choice.badge ? `${labelId} ${badgeId}` : labelId}
      aria-describedby={choice.description ? descriptionId : undefined}
      className="relative my-0.5 flex cursor-default items-start gap-2 rounded-md py-2 pr-8 pl-3 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[state=checked]:bg-brand-soft [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
    >
      {choice.icon && <span className="mt-0.5 flex shrink-0">{choice.icon}</span>}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          {/* Wraps rather than truncates: a decision label names where the choice leads. */}
          <Select.ItemText id={labelId} className="min-w-0 break-words">
            {choice.label}
          </Select.ItemText>
          {choice.badge && (
            <StatusBadge id={badgeId} kind={choice.badgeKind ?? "attention"}>
              {choice.badge}
            </StatusBadge>
          )}
        </span>
        {choice.description && (
          <span id={descriptionId} className="text-2xs break-words text-muted-foreground">
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
