import { useEffect, useRef } from "react";
import { Flag } from "lucide-react";
import {
  FINISH_BLOCK_ID,
  type FlowEnding,
  type RunDetail,
  type RunResult,
} from "@t3-factory/contracts";
import { blockedWorkers } from "../attention-copy.ts";
import { isSingleOutput } from "../block-kind.ts";
import { capturedExits } from "../flow-graph.ts";
import { blockName, capturedEnding } from "../run-evidence.ts";
import { runResultState } from "../run-status.ts";
import { clockTime } from "../time-format.ts";
import { InspectorSection } from "./inspector-section.tsx";
import { InspectedHeader } from "./run-block-view.tsx";
import { NoResult, ResultDetails } from "./run-result-section.tsx";
import { StatusBadge } from "./status-badge.tsx";
import { TechnicalDetails } from "./technical-details.tsx";

function listed(names: readonly string[]) {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
}

function endedText(run: RunDetail, result: RunResult) {
  const reaching = `Reaching ${result.endingName}`;
  const at = clockTime(result.acceptedAt);
  if (run.settlement) {
    const stopping = [
      ...new Set(
        run.settlement.workers
          .filter((worker) => worker.state === "stopping")
          .map((worker) => worker.blockName),
      ),
    ];
    const unresolved = [...new Set(blockedWorkers(run).map((worker) => worker.blockName))];
    const progress = stopping.length
      ? `${reaching} is stopping ${listed(stopping)}.`
      : `${reaching} closed the Run to new work.`;
    const problem = unresolved.length
      ? ` Factory couldn’t confirm the stop for ${listed(unresolved)}.`
      : "";
    return `${progress}${problem} Edits made in the workspace stay.`;
  }
  const stopped = run.blocks.filter((block) => block.state === "stopped").map((b) => b.name);
  if (!stopped.length) return `${reaching} ended the Run at ${at}.`;
  return `${reaching} stopped ${listed(stopped)} at ${at}. Edits ${stopped.length > 1 ? "they" : "it"} made in the workspace stay.`;
}

const outputWords = { required: "Output required", optional: "Output optional" } as const;

function endingLine(ending: FlowEnding, result: RunResult | null) {
  const reached = result?.endingId === ending.id;
  const output =
    ending.output === "none"
      ? "Output none"
      : `${outputWords[ending.output]}${ending.outputDescription ? `: ${ending.outputDescription}` : ""}`;
  return [
    ending.name,
    result && (reached ? `Reached ${clockTime(result.acceptedAt)}` : "Not reached"),
    output,
  ]
    .filter(Boolean)
    .join(" · ");
}

function incomingWires(run: RunDetail) {
  const { graph } = run.definitions.flow;
  return graph.connections.flatMap((connection) => {
    if (!connection.targetEndingId) return [];
    const ending = capturedEnding(run, connection.targetEndingId);
    const exit = capturedExits(run.definitions, connection.sourceBlockId).find(
      (item) => item.id === connection.exitId,
    );
    const exitName = exit && isSingleOutput(exit) ? null : (exit?.name ?? connection.exitId);
    return [
      `${ending?.name ?? connection.targetEndingId} ← ${blockName(run, connection.sourceBlockId)}${exitName ? ` → ${exitName}` : ""}`,
    ];
  });
}

export function RunFinishView({ run, onBack }: { run: RunDetail; onBack: () => void }) {
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    content.current?.focus();
  }, []);
  const { result } = run;
  const state = runResultState(run);
  const wires = incomingWires(run);
  return (
    <div
      ref={content}
      tabIndex={-1}
      className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-4 pt-3 pb-3 outline-none"
    >
      <InspectedHeader
        Icon={Flag}
        title="Finish"
        subtitle={
          result
            ? `Reached · ${result.endingName} · ${clockTime(result.acceptedAt)}`
            : state === "not-yet"
              ? "No ending reached yet"
              : "No ending reached"
        }
        badge={
          result && (
            <StatusBadge kind="neutral" icon={Flag}>
              Reached
            </StatusBadge>
          )
        }
        onBack={onBack}
      />
      {result ? (
        <>
          <InspectorSection title={`Result · ending ${result.endingName}`} label="Run result">
            <ResultDetails run={run} result={result} />
          </InspectorSection>
          <InspectorSection title="Ended the Run">
            <p className="text-sm text-muted-foreground">{endedText(run, result)}</p>
          </InspectorSection>
        </>
      ) : (
        (state === "not-yet" || state === "not-reached") && (
          <InspectorSection title="Result" label="Run result">
            <NoResult state={state} />
          </InspectorSection>
        )
      )}
      <InspectorSection title="Endings">
        {run.definitions.flow.graph.finish?.endings.length ? (
          <ul className="flex flex-col text-sm text-muted-foreground">
            {run.definitions.flow.graph.finish?.endings.map((ending) => (
              <li key={ending.id}>{endingLine(ending, result)}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No endings. The Run ends when its branches stop.
          </p>
        )}
      </InspectorSection>
      {wires.length > 0 && (
        <InspectorSection title="Incoming wires">
          <ul className="flex flex-col text-sm text-foreground">
            {wires.map((wire, index) => (
              <li key={index}>{wire}</li>
            ))}
          </ul>
        </InspectorSection>
      )}
      <div aria-hidden className="flex-1" />
      <TechnicalDetails
        details={[
          ["Block", FINISH_BLOCK_ID],
          ["Revision", String(run.definitions.flow.revision)],
          ["Delivery", result?.deliveryId],
        ]}
      />
    </div>
  );
}
