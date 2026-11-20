import { RadioGroup } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * Figma Settings v2/Segmented: a short exclusive choice in one bordered track, with radio
 * semantics. `sm` is the compact track of Figma Studio/DuplicateAgentRow; `fill` stretches the
 * track over its row in equal segments, as a Finish ending's Output (Figma SegmentedChoice).
 */
export function SegmentedChoice<Value extends string>({
  labelledBy,
  value,
  options,
  onChange,
  size,
  fill,
  disabled,
}: {
  labelledBy: string;
  value: Value;
  options: readonly (readonly [Value, string])[];
  onChange: (value: Value) => void;
  size?: "sm";
  fill?: boolean;
  disabled?: boolean;
}) {
  return (
    <RadioGroup.Root
      aria-labelledby={labelledBy}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const option = options.find(([candidate]) => candidate === next);
        if (option) onChange(option[0]);
      }}
      className={cn(
        "flex shrink-0 gap-0.5 rounded-md border bg-background p-0.5",
        fill ? "min-w-0 flex-1" : "w-fit",
      )}
    >
      {options.map(([option, title]) => (
        <RadioGroup.Item
          key={option}
          value={option}
          className={cn(
            "rounded-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-ring disabled:pointer-events-none disabled:opacity-50",
            size === "sm" ? "h-5.5 px-2.5 text-2xs" : "h-6.5 px-3 text-sm",
            fill && "min-w-0 flex-1 truncate px-1",
            "data-[state=checked]:bg-sidebar-accent data-[state=checked]:text-foreground",
            // Forced colors drop the fill; system highlight colors keep the selection visible.
            "forced-colors:data-[state=checked]:bg-[Highlight] forced-colors:data-[state=checked]:text-[HighlightText] forced-colors:data-[state=checked]:forced-color-adjust-none",
          )}
        >
          {title}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
