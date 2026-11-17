import { MutationGate } from "@/client-gate";
import { useState } from "react";
import type { FactoryProject, FlowDraft } from "@t3-factory/contracts";
import { Plus, ChevronRight, CircleCheck, TriangleAlert, Workflow } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StudioLink } from "../components/app-link.tsx";
import { StudioListHeader, studioRowClass, editedLabel } from "../components/studio-list.tsx";
import { OwnerFilter, OwnerGroupHeader, ownerName } from "../components/studio-owner.tsx";
import {
  ownerGroups,
  studioOwner,
  useStudioOwners,
  useStudioRead,
  type OwnerGroup,
  type StudioDefinitions,
  type StudioOwner,
  type StudioOwnerFilter,
} from "../studio-definitions.ts";
import { useStudioNavigation } from "../settings-navigation.ts";
import { openImported } from "../definition-import.ts";

const flowCount = (count: number) => `${count} ${count === 1 ? "Flow" : "Flows"}`;

/** What the list footer says the owner filter shows. */
function filterSummary(filter: StudioOwnerFilter, projects: readonly FactoryProject[]) {
  if (filter.kind === "all") return "Owner: All. Each group is one owner; Global first.";
  if (filter.kind === "global") return "Owner: Global shows only Global Flows.";
  const { title } = studioOwner(filter.projectId, projects);
  return `Owner: ${title} shows Global Flows and ${title}’s Flows.`;
}

export function FlowList({
  definitions,
  onCreate,
}: {
  definitions: StudioDefinitions;
  onCreate: () => void;
}) {
  const openStudio = useStudioNavigation();
  const flows = useStudioRead(definitions, "flows");
  const { projects, filter, setFilter } = useStudioOwners(definitions);
  const items = flows.value;
  const error = flows.error ? "Could not load Flows. Check that Factory is running." : "";
  const [query, setQuery] = useState("");
  const matching =
    items?.filter((flow) =>
      flow.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    ) ?? null;
  const groups = matching && ownerGroups(matching, projects, filter);
  const shown = groups?.reduce((total, group) => total + group.items.length, 0) ?? 0;
  return (
    <main className="grid content-start gap-5 px-8 pt-6 pb-8 max-sm:px-4">
      <StudioListHeader
        title="Flows"
        description="Global Flows run in every project. Project Flows run only in their owning Project."
        query={query}
        onQueryChange={setQuery}
        onCreate={onCreate}
        createLabel="New Flow"
        onImported={(result) => void openImported(result, definitions, openStudio)}
        projects={projects}
        filter={<OwnerFilter filter={filter} projects={projects} onChange={setFilter} />}
      />
      {items && items.length > 0 && groups?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {query.trim() ? "No Flows match your search." : "No Flows for this owner."}
        </p>
      ) : (
        <FlowItems groups={groups} error={error} onCreate={onCreate} />
      )}
      {items && items.length > 0 && (
        <p className="text-2xs tracking-label text-subtle-foreground">
          {flowCount(shown)} · {filterSummary(filter, projects)}
        </p>
      )}
    </main>
  );
}

function FlowItems({
  groups,
  error,
  onCreate,
}: {
  groups: readonly OwnerGroup<FlowDraft>[] | null;
  error: string;
  onCreate: () => void;
}) {
  if (error)
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  if (groups === null)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading Flows…
      </p>
    );
  if (groups.length === 0)
    return (
      <section className="flex min-h-105 flex-col items-center justify-center rounded-lg border border-dashed border-border-strong px-6 py-12 text-center">
        <Workflow aria-hidden className="mb-4 size-8 text-subtle-foreground" strokeWidth={1.5} />
        <h2 className="text-title font-semibold">No Flows yet</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Create a Flow to give your process a name. Add Agent, Human and Continuation blocks on the
          canvas, then save it for every project or for one.
        </p>
        <div className="mt-5 flex items-center gap-3">
          <MutationGate>
            <Button type="button" onClick={onCreate}>
              <Plus aria-hidden strokeWidth={1.5} />
              New Flow
            </Button>
          </MutationGate>
          <StudioLink selection={{ tab: "agents", agentId: "new" }} className="text-sm">
            Define an Agent first
          </StudioLink>
        </div>
      </section>
    );
  return (
    <div className="flex flex-col gap-2">
      {groups.map(({ owner, items }) => (
        <section
          key={owner.projectId ?? "global"}
          aria-label={ownerName(owner)}
          className="flex flex-col gap-2"
        >
          <OwnerGroupHeader
            owner={owner}
            count={flowCount(items.length)}
            consequence="Flows here can’t start."
          />
          {items.map((flow) => (
            <FlowRow key={flow.id} flow={flow} owner={owner} />
          ))}
        </section>
      ))}
    </div>
  );
}

function FlowRow({ flow, owner }: { flow: FlowDraft; owner: StudioOwner }) {
  return (
    <StudioLink selection={{ tab: "flows", flowId: flow.id }} className={studioRowClass}>
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-muted-foreground">
        <Workflow aria-hidden className="size-4" strokeWidth={1.5} />
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <h3 className="truncate text-sm font-medium">{flow.name}</h3>
        <p className="truncate text-2xs tracking-label text-subtle-foreground">
          {flow.graph.blocks.length} {flow.graph.blocks.length === 1 ? "block" : "blocks"} ·
          Revision {flow.revision} ·{" "}
          {owner.projectId === null ? "Global" : `Owned by ${owner.title}`}
        </p>
      </div>
      {owner.unavailable ? (
        <Badge variant="attention" className="max-w-64 border-transparent">
          <TriangleAlert aria-hidden strokeWidth={1.5} />
          <span className="truncate">Can’t start — {owner.unavailable}</span>
        </Badge>
      ) : flow.readiness.ready ? (
        <Badge variant="success" className="border-transparent">
          <CircleCheck aria-hidden strokeWidth={1.5} />
          Ready
        </Badge>
      ) : (
        <Badge variant="attention" className="max-w-64 border-transparent">
          <TriangleAlert aria-hidden strokeWidth={1.5} />
          <span className="truncate">
            Not ready
            {flow.readiness.issues[0] ? ` — ${flow.readiness.issues[0].message}` : ""}
          </span>
        </Badge>
      )}
      <span className="shrink-0 text-2xs tracking-label text-subtle-foreground">
        {editedLabel(flow.updatedAt)}
      </span>
      <ChevronRight
        aria-hidden
        className="size-4 shrink-0 text-subtle-foreground"
        strokeWidth={1.5}
      />
    </StudioLink>
  );
}
