import { Link, useNavigate } from "@tanstack/react-router";
import type { TriggerStartedRun } from "@t3-factory/contracts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** “N Runs” opens the one Run, or a menu of them. The check itself stays in the current view. */
export function StartedRuns({
  runs,
  standalone = false,
}: {
  runs: readonly TriggerStartedRun[];
  standalone?: boolean;
}) {
  const navigate = useNavigate();
  const label = `${runs.length} ${runs.length === 1 ? "Run" : "Runs"}`;
  const open = (id: string) =>
    void navigate({ to: "/runs/$runId", params: { runId: id }, search: {} });
  const className = "relative z-10 text-link hover:underline";
  if (runs.length === 1) {
    const run = runs[0]!;
    if (standalone)
      return (
        <>
          Started{" "}
          <Link to="/runs/$runId" params={{ runId: run.id }} search={{}} className={className}>
            {label}
          </Link>
        </>
      );
    return (
      <>
        Started{" "}
        <button type="button" className={className} onClick={() => open(run.id)}>
          {label}
        </button>
      </>
    );
  }
  return (
    <>
      Started{" "}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={className}>
            {label}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {runs.map((run) => (
            <DropdownMenuItem key={run.id} onSelect={() => open(run.id)}>
              {run.number === null ? run.title || "Run" : `#${run.number} ${run.title}`}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
