import { useId } from "react";
import { Trash2 } from "lucide-react";
import {
  type FactoryProject,
  type FlowBlock,
  type FlowConnection,
  type FlowDraft,
  type FlowGraph,
  type ReadinessIssue,
} from "@t3-factory/contracts";
import { exitsWithEndings, reachesEnding, subflowCyclePath } from "@t3-factory/domain-validation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TextLink } from "@/components/ui/text-link";
import { connectionWire, type FlowWire } from "../flow-graph.ts";
import { studioOwner } from "../studio-definitions.ts";
import { StudioLink } from "./app-link.tsx";
import { EndingExpectations, PanelHeading, TargetSelect } from "./block-exit-configuration.tsx";
import { ChoiceMenu, type MenuChoice } from "./choice-menu.tsx";
import { fieldProblem, issueTag, type BlockIssue } from "./flow-readiness.tsx";
import { ProblemCard } from "./problem-card.tsx";
import { StatusBadge } from "./status-badge.tsx";

type SubflowBlock = Extract<FlowBlock, { kind: "subflow" }>;

export type BlockFlows = {
  readonly current: {
    readonly id: string;
    readonly name: string;
    readonly projectId: string | null;
  };
  readonly all: readonly FlowDraft[];
  readonly placeable: readonly FlowDraft[];
  readonly projects: readonly FactoryProject[];
};

function flowChoiceDescription(
  candidate: FlowDraft,
  current: BlockFlows["current"],
  flowMap: ReadonlyMap<string, FlowDraft>,
): { readonly description: string; readonly disabled: boolean } {
  if (candidate.id === current.id) return { description: "This Flow, would loop", disabled: true };
  if (subflowCyclePath(current.id, candidate.id, flowMap))
    return { description: `Uses ${current.name}, would loop`, disabled: true };
  if (!reachesEnding(candidate.graph))
    return { description: "No reachable ending", disabled: false };
  const count = candidate.graph.finish?.endings.length ?? 0;
  return {
    description: `${count} ${count === 1 ? "ending" : "endings"} · Revision ${candidate.revision}`,
    disabled: false,
  };
}

function FlowPicker({
  id,
  block,
  flows,
  flowMap,
  describedBy,
  onEdit,
}: {
  id: string;
  block: SubflowBlock;
  flows: BlockFlows;
  flowMap: ReadonlyMap<string, FlowDraft>;
  describedBy: string | undefined;
  onEdit: (block: FlowBlock) => void;
}) {
  const chosen = block.flowId ? flowMap.get(block.flowId) : undefined;
  const choices = flows.placeable.map((candidate): MenuChoice => {
    const meta = flowChoiceDescription(candidate, flows.current, flowMap);
    return {
      id: candidate.id,
      label: candidate.name,
      description: meta.description,
      disabled: meta.disabled,
    };
  });
  return (
    <ChoiceMenu
      id={id}
      label="Flow"
      value={block.flowId ?? ""}
      choices={[
        ...choices.filter((choice) => !choice.disabled),
        ...choices.filter((choice) => choice.disabled),
      ]}
      unlistedLabel={chosen?.name ?? "Missing Flow"}
      disabled={false}
      placeholder="Choose a Flow"
      empty="No Flows to place"
      describedBy={describedBy}
      problemTone="error"
      className="h-8 border-input bg-background"
      onChange={(nextFlowId) => onEdit({ ...block, flowId: nextFlowId })}
    />
  );
}

function wireTargetLabel(graph: FlowGraph, connection: FlowConnection) {
  if (connection.targetEndingId !== undefined) {
    const ending = graph.finish?.endings.find((item) => item.id === connection.targetEndingId);
    return `Finish · ${ending?.name || connection.targetEndingId}`;
  }
  const target = graph.blocks.find((item) => item.id === connection.targetBlockId);
  return target?.name || connection.targetBlockId;
}

function NestedFindingsSection({
  issues,
  flowMap,
}: {
  issues: readonly ReadinessIssue[];
  flowMap: ReadonlyMap<string, FlowDraft>;
}) {
  const nested = issues.filter((issue) => issue.nested !== undefined);
  if (nested.length === 0) return null;
  return (
    <section aria-label="Issues inside placed Flows" className="grid gap-2">
      <PanelHeading>Issues inside</PanelHeading>
      {nested.map((issue, index) => {
        const targetFlow = flowMap.get(issue.nested!.flowId);
        return (
          <ProblemCard
            key={index}
            tone="error"
            density="compact"
            title={issue.message}
            action={
              targetFlow ? (
                <TextLink asChild>
                  <StudioLink selection={{ tab: "flows", flowId: targetFlow.id }}>
                    Open {targetFlow.name}
                  </StudioLink>
                </TextLink>
              ) : undefined
            }
          />
        );
      })}
    </section>
  );
}

function BrokenWiresSection({
  brokenWires,
  graph,
  onWireChange,
}: {
  brokenWires: readonly FlowConnection[];
  graph: FlowGraph;
  onWireChange: (wire: FlowWire, connected: boolean) => void;
}) {
  if (brokenWires.length === 0) return null;
  return (
    <section aria-label="Broken wires" className="grid gap-2">
      <PanelHeading>Broken wires</PanelHeading>
      <ul className="grid divide-y overflow-hidden rounded-lg border border-destructive/50">
        {brokenWires.map((connection, index) => {
          const target = wireTargetLabel(graph, connection);
          return (
            <li
              key={`${connection.exitId}:${connection.targetBlockId}:${connection.targetEndingId ?? ""}:${index}`}
              className="flex items-center gap-2 px-3 py-2.5"
            >
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="truncate text-attention line-through">{connection.exitId}</span>
                  <StatusBadge kind="error">Missing exit</StatusBadge>
                </span>
                <span className="truncate text-xs text-muted-foreground">→ {target}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Remove broken wire ${connection.exitId} to ${target}`}
                onClick={() => onWireChange(connectionWire(connection), false)}
              >
                <Trash2 aria-hidden className="size-3.5" />
                Remove
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function SubflowBlockSettings({
  block,
  graph,
  flows,
  issues,
  onEdit,
  onWireChange,
}: {
  block: SubflowBlock;
  graph: FlowGraph;
  flows: BlockFlows;
  issues: readonly BlockIssue[];
  onEdit: (block: FlowBlock) => void;
  onWireChange: (wire: FlowWire, connected: boolean) => void;
}) {
  const flowFieldId = useId();
  const flowMap = new Map(flows.all.map((flow) => [flow.id, flow]));
  const child = block.flowId ? flowMap.get(block.flowId) : undefined;
  const flowProblem = fieldProblem(issues, "flowId");
  const ownerTitle = child ? studioOwner(child.projectId, flows.projects).title : "";
  const endings = child?.graph.finish?.endings ?? [];
  const exits = new Map(exitsWithEndings(block, graph, [], flowMap).map((exit) => [exit.id, exit]));
  const validEndingIds = new Set(endings.map((ending) => ending.id));
  const brokenWires = graph.connections.filter(
    (connection) =>
      connection.sourceBlockId === block.id &&
      (child === undefined || !validEndingIds.has(connection.exitId)),
  );
  const directIssues = issues.map((item) => item.issue);
  return (
    <>
      <div className="grid gap-1.5">
        <div className="flex min-h-5 items-center gap-2">
          <Label
            htmlFor={flowFieldId}
            className="text-label font-normal tracking-label text-muted-foreground"
          >
            Flow
          </Label>
          {flowProblem && (
            <StatusBadge kind="error" className="ml-auto">
              {issueTag(flowProblem)}
            </StatusBadge>
          )}
        </div>
        <FlowPicker
          id={flowFieldId}
          block={block}
          flows={flows}
          flowMap={flowMap}
          describedBy={flowProblem && `${flowFieldId}-problem`}
          onEdit={onEdit}
        />
        {flowProblem && (
          <ProblemCard
            id={`${flowFieldId}-problem`}
            tone="error"
            density="compact"
            title={flowProblem.message}
          />
        )}
        {child && (
          <div className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {ownerTitle} · Revision {child.revision} ·{" "}
              {endings.length === 1 ? "1 ending" : `${endings.length} endings`}
            </span>
            <TextLink asChild className="shrink-0">
              <StudioLink selection={{ tab: "flows", flowId: child.id }}>Open Flow</StudioLink>
            </TextLink>
          </div>
        )}
      </div>
      {child && (
        <>
          <section aria-label="Workspace" className="grid gap-1">
            <PanelHeading>Workspace</PanelHeading>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Runs in this Run’s workspace. {child.name}’s own Workspace setting applies only when
              it starts on its own.
            </p>
          </section>
          <section aria-label="Revision" className="grid gap-1">
            <PanelHeading>Revision</PanelHeading>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Each Start uses {child.name}’s latest saved revision. Later edits apply to the next
              Start.
            </p>
          </section>
          <section aria-label="Blocks inside" className="grid gap-1">
            <PanelHeading>Blocks inside</PanelHeading>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Use Open Flow to edit {child.name}. Wire its input and named exits here.
            </p>
          </section>
          <section aria-label="Exits" className="grid gap-2">
            <PanelHeading>Exits</PanelHeading>
            {endings.length > 0 ? (
              <ul className="grid divide-y overflow-hidden rounded-lg border">
                {endings.map((ending) => {
                  const name = ending.name || "Unnamed ending";
                  return (
                    <li
                      key={ending.id}
                      aria-label={`Exit ${name}`}
                      className="grid gap-2 px-3 py-2.5"
                    >
                      <span className="text-sm font-medium">{name}</span>
                      <TargetSelect
                        graph={graph}
                        source={{ kind: "exit", sourceBlockId: block.id, exitId: ending.id }}
                        label={`exit ${name}`}
                        onWireChange={onWireChange}
                      />
                      <EndingExpectations exit={exits.get(ending.id)} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                {child.name} has no Finish endings yet.{" "}
                <TextLink asChild>
                  <StudioLink selection={{ tab: "flows", flowId: child.id }}>Open Flow</StudioLink>
                </TextLink>
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Each exit comes from a Finish ending in {child.name}.
            </p>
          </section>
        </>
      )}
      <BrokenWiresSection brokenWires={brokenWires} graph={graph} onWireChange={onWireChange} />
      <NestedFindingsSection issues={directIssues} flowMap={flowMap} />
    </>
  );
}
