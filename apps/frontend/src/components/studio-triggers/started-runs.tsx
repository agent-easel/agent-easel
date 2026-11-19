import { useNavigate } from "@tanstack/react-router";
import type { TriggerStartedRun } from "@t3-factory/contracts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TextLink } from "@/components/ui/text-link";
import { AppLink } from "../app-link.tsx";

// Lifts the link above a list row's stretched title link.
const className = "relative z-10";

/** “N Runs” opens the one Run, or a menu of them. The check itself stays in the current view. */
export function StartedRuns({ runs }: { runs: readonly TriggerStartedRun[] }) {
  const navigate = useNavigate();
  const label = `${runs.length} ${runs.length === 1 ? "Run" : "Runs"}`;
  if (runs.length === 1)
    return (
      <>
        Started{" "}
        <TextLink asChild className={className}>
          <AppLink to="/runs/$runId" params={{ runId: runs[0]!.id }} search={{}}>
            {label}
          </AppLink>
        </TextLink>
      </>
    );
  return (
    <>
      Started{" "}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <TextLink className={className}>{label}</TextLink>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {runs.map((run) => (
            <DropdownMenuItem
              key={run.id}
              onSelect={() =>
                void navigate({ to: "/runs/$runId", params: { runId: run.id }, search: {} })
              }
            >
              {run.number === null ? run.title || "Run" : `#${run.number} ${run.title}`}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
