import { useEffect, useMemo, useState } from "react";
import type {
  RunBlock,
  RunDetail,
  SubflowInvocation,
  SubflowInvocationPath,
  SubflowPlacementSummary,
} from "@t3-factory/contracts";
import { api } from "./api.ts";
import { selectExecutionTargets } from "./execution-focus.ts";
import { placementKey } from "./subflow-preview.ts";

const EMPTY_SELECTIONS: ReadonlyMap<string, SubflowInvocation> = new Map();

function scopedRun(
  run: RunDetail,
  invocation: SubflowInvocation,
  blocks: ReadonlyMap<string, RunBlock>,
) {
  const flow = run.definitions.subflows!.find((item) => item.id === invocation.flowId)!;
  const id = (templateId: string) => blocks.get(templateId)?.blockId ?? templateId;
  const graph = flow.graph;
  return {
    ...run,
    input: invocation.input,
    images: invocation.carriesStartImages ? run.images : [],
    titleGeneration: null,
    gateOpen: run.gateOpen && invocation.state === "active",
    result: invocation.ending,
    blocks: invocation.blocks,
    definitions: {
      ...run.definitions,
      flow: {
        ...flow,
        graph: {
          ...graph,
          blocks: graph.blocks.map((block) => ({ ...block, id: id(block.id) })),
          connections: graph.connections.map((wire) => ({
            ...wire,
            sourceBlockId: id(wire.sourceBlockId),
            targetBlockId:
              wire.targetEndingId === undefined ? id(wire.targetBlockId) : wire.targetBlockId,
          })),
          flowInput: { ...graph.flowInput, targetBlockIds: graph.flowInput.targetBlockIds.map(id) },
        },
      },
    },
  } satisfies RunDetail;
}

type Scope = {
  readonly run: RunDetail;
  readonly blocks: ReadonlyMap<string, RunBlock>;
  readonly invocation?: SubflowInvocation;
};

type Placement = {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly parent: Scope;
  readonly invocation: SubflowInvocation | null;
  readonly summary: SubflowPlacementSummary | undefined;
};

function indexRunSubflows(
  run: RunDetail,
  selected: ReadonlyMap<string, SubflowInvocation>,
  loaded?: ReadonlyMap<string, SubflowInvocationPath>,
) {
  const scopes = new Map<string, Scope>();
  const placements = new Map<string, Placement>();
  const byBlock = new Map<string, { path: string; scope: Scope }>();
  const summaries = new Map(run.subflows?.map((item) => [item.blockId, item]));
  const liveBlocks = new Map(run.blocks.map((block) => [block.blockId, block]));
  for (const invocation of selected.values()) {
    const evidence = loaded?.get(invocation.id);
    for (const placement of evidence?.placements ?? [])
      if (!summaries.has(placement.blockId)) summaries.set(placement.blockId, placement);
  }
  function visit(path: string, scope: Scope) {
    scopes.set(path, scope);
    for (const [templateId, block] of scope.blocks)
      byBlock.set(block.blockId, { path: placementKey(path, templateId), scope });
    for (const block of scope.run.definitions.flow.graph.blocks) {
      if (block.kind !== "subflow") continue;
      const runtime = byBlock.get(block.id);
      if (!runtime) continue;
      const summary = summaries.get(block.id);
      const pinned = selected.get(block.id);
      const invocation =
        pinned && pinned.id !== summary?.defaultInvocation?.id
          ? (loaded?.get(pinned.id)?.invocation ?? pinned)
          : (summary?.defaultInvocation ?? null);
      const placement = {
        id: block.id,
        path: runtime.path,
        name: block.name,
        parent: scope,
        invocation,
        summary,
      };
      placements.set(runtime.path, placement);
      if (invocation) {
        const visible = {
          ...invocation,
          blocks: invocation.blocks.map((inner) => liveBlocks.get(inner.blockId) ?? inner),
        };
        const blocks = new Map(visible.blocks.map((inner) => [inner.templateBlockId!, inner]));
        visit(runtime.path, { run: scopedRun(run, visible, blocks), blocks, invocation });
      }
    }
  }
  if (run.subflows?.length)
    visit("", {
      run,
      blocks: new Map(
        run.blocks.filter((block) => !block.invocationId).map((block) => [block.blockId, block]),
      ),
    });
  return { scopes, placements, byBlock };
}

export function invocationBlockPath(evidence: SubflowInvocationPath, blockId: string) {
  let path = "";
  let parent: SubflowInvocation | undefined;
  for (const invocation of [...evidence.ancestors, evidence.invocation]) {
    const template = parent?.blocks.find((block) => block.blockId === invocation.placementBlockId);
    path = placementKey(path, template?.templateBlockId ?? invocation.placementBlockId);
    parent = invocation;
  }
  if (blockId === evidence.invocation.placementBlockId) return path;
  const block = evidence.invocation.blocks.find((item) => item.blockId === blockId);
  return block?.templateBlockId && placementKey(path, block.templateBlockId);
}

export function useRunSubflows(run: RunDetail) {
  const [pinned, setPinned] = useState<ReadonlyMap<string, SubflowInvocation>>(EMPTY_SELECTIONS);
  const [loaded, setLoaded] = useState<ReadonlyMap<string, SubflowInvocationPath>>(() => new Map());
  const [error, setError] = useState("");
  const followed = useMemo(() => indexRunSubflows(run, EMPTY_SELECTIONS), [run]);
  const current = useMemo(
    () => (pinned.size ? indexRunSubflows(run, pinned, loaded) : followed),
    [run, pinned, followed, loaded],
  );
  const summaries = useMemo(
    () => new Map(run.subflows?.map((item) => [item.blockId, item])),
    [run.subflows],
  );
  const runId = run.id;
  const { events, intents, subflows } = run;
  const refreshKey = JSON.stringify(
    [...pinned.values()].flatMap((invocation) => {
      const live = summaries.get(invocation.placementBlockId)?.defaultInvocation;
      return live?.id === invocation.id ? [] : [invocation.id];
    }),
  );

  useEffect(() => {
    if (!pinned.size) return;
    let current = true;
    const requests = JSON.parse(refreshKey) as string[];
    for (const invocationId of requests) {
      void api.getSubflowInvocation(runId, invocationId).then(
        (evidence) => {
          if (current) setLoaded((previous) => new Map(previous).set(invocationId, evidence));
        },
        (cause: unknown) => {
          if (current)
            setError(
              cause instanceof Error ? cause.message : "Could not read the selected invocation.",
            );
        },
      );
    }
    return () => {
      current = false;
    };
  }, [events, intents, pinned, refreshKey, runId, subflows]);

  const inspectInvocation = (invocation: SubflowInvocation) => {
    setError("");
    setPinned((previous) => new Map(previous).set(invocation.placementBlockId, invocation));
  };
  const inspectPath = (evidence: SubflowInvocationPath) => {
    setError("");
    setLoaded((previous) => new Map(previous).set(evidence.invocation.id, evidence));
    setPinned(
      new Map(
        [...evidence.ancestors, evidence.invocation].map((item) => [item.placementBlockId, item]),
      ),
    );
  };
  const resumeCurrentInvocations = () => {
    setPinned(EMPTY_SELECTIONS);
    setError("");
  };
  return { ...current, followed, inspectInvocation, inspectPath, resumeCurrentInvocations, error };
}

export type RunSubflows = ReturnType<typeof useRunSubflows>;

export function selectComposedExecutionTargets(run: RunDetail, subflows: RunSubflows) {
  const targets = selectExecutionTargets(run);
  if (!subflows.followed.placements.size) return targets;
  const intents = new Map(run.intents.map((intent) => [intent.id, intent]));
  const reports = new Map(run.reports.map((report) => [report.id, report]));
  const blocks = new Map(run.blocks.map((block) => [block.blockId, block]));
  const handedOff = new Set<string>();
  for (const id of targets) {
    let path = subflows.followed.byBlock.get(id)?.path ?? "";
    while (path.lastIndexOf("/") > 0) {
      path = path.slice(0, path.lastIndexOf("/"));
      const invocation = subflows.followed.placements.get(path)?.invocation;
      const intent = invocation?.incomingIntentId && intents.get(invocation.incomingIntentId);
      if (!intent || intent.state !== "acknowledged" || !intent.reportId || !intent.sourceBlockId)
        continue;
      const source = blocks.get(intent.sourceBlockId);
      const report = reports.get(intent.reportId);
      if (source?.executionId && report?.executionId === source.executionId)
        handedOff.add(source.blockId);
    }
  }
  return targets.filter((id) => !handedOff.has(id));
}
