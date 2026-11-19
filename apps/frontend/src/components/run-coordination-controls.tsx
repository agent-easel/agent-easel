import type { RunDetail } from "@t3-factory/contracts";
import { fullDateTime } from "../time-format.ts";
import { sectionLabelClass } from "./page.tsx";

export function RootWork({ run }: { run: RunDetail }) {
  const root = run.runCoordinator;
  if (!root) return null;
  return (
    <section aria-label="Run conversation operations" className="flex flex-col gap-3 text-xs">
      <h2 className={sectionLabelClass}>Run conversation operations</h2>
      <p>
        Observation {root.freshness} ·{" "}
        {root.observedAt ? fullDateTime(root.observedAt) : "observed time unknown"}
      </p>
      <p>
        Engine {root.engineStatus ?? "unknown"} · queue {root.queuedCount ?? "unknown"} · native
        requests {root.pendingRequestCount ?? "unknown"}
      </p>
      <p>
        Pending operations {root.pendingOperationCount} · pending Stop {root.pendingStopCount}
      </p>
      <h3 className="font-semibold">Root work history</h3>
      {!run.rootWork.length && <p>No execution work periods observed.</p>}
      {run.rootWork.map((work) => (
        <article key={work.executionId} className="flex flex-col gap-1 rounded border p-2">
          <p>
            {work.control ? "Owned control" : "Observed conversation turn"} · {work.executionId} ·{" "}
            {work.engineStatus ?? "unknown"}
          </p>
          <p>
            First observed working:{" "}
            {work.observedStartedAt ? fullDateTime(work.observedStartedAt) : "unknown"}
          </p>
          <p>
            First observed terminal:{" "}
            {work.observedEndedAt ? fullDateTime(work.observedEndedAt) : "unknown"}
          </p>
        </article>
      ))}
    </section>
  );
}
