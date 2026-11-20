import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type SetupStepState = "done" | "current" | "upcoming";

const indicators: Record<SetupStepState, string> = {
  done: "bg-success text-primary-foreground",
  current: "border-[1.5px] border-primary text-primary",
  upcoming: "border-[1.5px] border-border text-subtle-foreground",
};

/** Announced after the title, since the indicator's colour and glyph are not read out. */
const stateNames: Record<SetupStepState, string> = {
  done: "done",
  current: "current step",
  upcoming: "upcoming step",
};

/** Figma Setup/StepHeader: a First-run setup step's indicator, title and one-sentence reason. */
export function SetupStepHeader({
  number,
  state,
  title,
  detail,
}: {
  number: number;
  state: SetupStepState;
  title: string;
  detail: string;
}) {
  const upcoming = state === "upcoming";
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden
        className={cn(
          "flex size-5.5 shrink-0 items-center justify-center rounded-full text-2xs leading-none font-medium",
          indicators[state],
        )}
      >
        {state === "done" ? <Check strokeWidth={2} className="size-3" /> : number}
      </span>
      <div
        className={cn(
          "grid min-w-0 flex-1 gap-0.5 text-sm leading-normal",
          upcoming ? "text-subtle-foreground" : "text-muted-foreground",
        )}
      >
        <h2
          aria-label={`${title}, ${stateNames[state]}`}
          className={cn("font-medium", !upcoming && "text-foreground")}
        >
          {title}
        </h2>
        <p>{detail}</p>
      </div>
    </div>
  );
}
