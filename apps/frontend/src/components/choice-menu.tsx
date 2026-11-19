import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "./status-badge.tsx";
import { fieldAria, fieldBorder } from "./field-state.ts";
import { selectFieldClass } from "@/components/page";
import { cn } from "@/lib/utils";

export interface MenuChoice {
  readonly id: string;
  readonly label: string;
  /** Short marker shown next to the label, in the menu and on the trigger. */
  readonly badge?: string;
  /** The badge's tone; attention unless the marker only explains a disabled choice. */
  readonly badgeKind?: "attention" | "neutral";
  /** Why the choice is limited; shown under the label in the menu. */
  readonly description?: string;
  readonly disabled?: boolean;
}

/**
 * A single choice from a short list, shown as a radio-style menu so unavailable choices
 * stay visible, cannot be chosen and explain why.
 */
export function ChoiceMenu({
  id,
  label,
  value,
  choices,
  onChange,
  disabled,
  placeholder,
  className,
  describedBy,
}: {
  id: string;
  /** The field label; the trigger's accessible name adds the current value. */
  label: string;
  value: string;
  choices: readonly MenuChoice[];
  onChange: (value: string) => void;
  disabled: boolean;
  placeholder: string;
  /** Trigger size where the form is denser than the composer, such as a Settings row. */
  className?: string;
  describedBy?: string | undefined;
}) {
  const selected = choices.find((choice) => choice.id === value);
  const shown = selected?.label ?? placeholder;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          id={id}
          variant="outline"
          aria-label={`${label}: ${selected ? `${shown}${selected.badge ? `, ${selected.badge}` : ""}` : shown}`}
          {...fieldAria(describedBy)}
          className={cn(
            selectFieldClass,
            "disabled:opacity-50 data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/30",
            className,
            fieldBorder(describedBy ? "attention" : undefined),
          )}
        >
          <span className={cn("min-w-0 truncate", !selected && "text-muted-foreground")}>
            {shown}
          </span>
          {selected?.badge && (
            <StatusBadge kind={selected.badgeKind ?? "attention"}>{selected.badge}</StatusBadge>
          )}
          <span className="flex-1" />
          <ChevronsUpDown
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.5}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[var(--radix-dropdown-menu-trigger-width)] max-w-[calc(100vw-1rem)]"
      >
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {choices.map((choice) => (
            <DropdownMenuRadioItem
              key={choice.id}
              value={choice.id}
              disabled={choice.disabled}
              indicatorPosition="right"
              className="my-0.5 rounded-md py-2 data-[state=checked]:bg-brand-soft"
            >
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{choice.label}</span>
                  {choice.badge && (
                    <StatusBadge kind={choice.badgeKind ?? "attention"}>{choice.badge}</StatusBadge>
                  )}
                </span>
                {choice.description && (
                  <span className="text-2xs text-muted-foreground">{choice.description}</span>
                )}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
