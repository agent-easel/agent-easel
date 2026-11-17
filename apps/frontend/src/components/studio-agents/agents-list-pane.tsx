import type { ReactNode } from "react";
import { MutationGate } from "@/client-gate";
import { Bot, ChevronDown, Plus, Search, Upload } from "lucide-react";
import type {
  AgentCapabilities,
  AgentDefinition,
  FlowDraft,
  ImportResult,
} from "@t3-factory/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StudioLink } from "../app-link.tsx";
import {
  agentRuntimeMeta,
  flowUsageCount,
  flowUsageLabel,
  projectOverridesLabel,
} from "@/lib/agent-display";
import { cn } from "@/lib/utils";
import { agentReportingStatus, useReportingState } from "../../reporting-state.tsx";
import { NeedsModel } from "../needs-model.tsx";
import {
  DefinitionImportDialog,
  useDefinitionImportChooser,
} from "../definition-import-control.tsx";
import { OwnerFilter, OwnerPath, ownerName } from "../studio-owner.tsx";
import { sectionLabelClass } from "../page.tsx";
import {
  ownerGroups,
  type OwnerGroup,
  type StudioOwnerFilter,
  type useStudioOwners,
} from "../../studio-definitions.ts";

export function AgentsListPane({
  agents,
  flows,
  capabilities,
  owners,
  selectedId,
  query,
  onQueryChange,
  onCreate,
  onImported,
  error,
  loading,
  creatingNew,
}: {
  agents: readonly AgentDefinition[] | null;
  flows: readonly FlowDraft[] | null;
  capabilities: AgentCapabilities | null;
  owners: ReturnType<typeof useStudioOwners>;
  selectedId: string | undefined;
  creatingNew: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onCreate: () => void;
  onImported: (result: ImportResult) => void;
  error: string;
  loading: boolean;
}) {
  const count = agents?.length ?? 0;
  return (
    <aside className="flex max-md:max-h-[42%] max-md:shrink-0 md:h-full min-h-0 min-w-0 w-full max-w-full shrink-0 flex-col border-r bg-background md:w-[300px]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pt-4 pb-3">
        <h2 className="text-title font-semibold">Agents</h2>
        {agents && (
          <span className="rounded-full border bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">
            {count}
          </span>
        )}
        <span className="flex-1" />
        <NewAgentButton projects={owners.projects} onCreate={onCreate} onImported={onImported} />
      </div>
      <AgentListTools query={query} onQueryChange={onQueryChange} owners={owners} />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 pt-1">
        {creatingNew && (
          <ul className="grid gap-1 pb-2">
            <li>
              <AgentListItemLink
                selected={selectedId === "new"}
                name="New Agent"
                meta="Draft · not saved yet"
                id="new"
              />
            </li>
          </ul>
        )}
        <AgentListRows
          agents={agents}
          query={query}
          owners={owners}
          flows={flows}
          capabilities={capabilities}
          selectedId={selectedId}
          error={error}
          loading={loading}
        />
      </div>
    </aside>
  );
}

/**
 * Figma SA01: **New Agent** creates an Agent; its menu holds **Import…**. The file chooser and the
 * review stay mounted outside the menu, which closes on select.
 */
function NewAgentButton({
  projects,
  onCreate,
  onImported,
}: {
  projects: ReturnType<typeof useStudioOwners>["projects"];
  onCreate: () => void;
  onImported: (result: ImportResult) => void;
}) {
  const importer = useDefinitionImportChooser();
  return (
    <>
      <MutationGate>
        <div className="flex shrink-0 gap-px">
          <Button onClick={onCreate}>
            <Plus aria-hidden strokeWidth={1.5} />
            New Agent
          </Button>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" className="w-7" aria-label="Other ways to add an Agent">
                    <ChevronDown aria-hidden strokeWidth={1.5} />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Other ways to add an Agent</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem aria-label="Import" onSelect={importer.choose}>
                <Upload aria-hidden strokeWidth={1.5} />
                Import…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </MutationGate>
      <DefinitionImportDialog importer={importer} projects={projects} onImported={onImported} />
    </>
  );
}

/** Search Agents and the owner filter Studio's lists share. */
function AgentListTools({
  query,
  onQueryChange,
  owners,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  owners: ReturnType<typeof useStudioOwners>;
}) {
  return (
    <div className="flex shrink-0 gap-2 px-3 pb-2">
      <div className="relative min-w-0 flex-1">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-2 left-2.5 size-3.5 text-subtle-foreground"
          strokeWidth={1.5}
        />
        <Input
          aria-label="Search Agents"
          placeholder="Search Agents"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          className="h-8 bg-muted pl-9 text-sm"
        />
      </div>
      <OwnerFilter
        filter={owners.filter}
        projects={owners.projects}
        onChange={owners.setFilter}
        className="w-28"
      />
    </div>
  );
}

/** What an empty Agent list says: nothing saved yet, or nothing the search and filter show. */
function emptyAgentsMessage(count: number, searching: boolean, filter: StudioOwnerFilter) {
  if (count === 0) return "No Agent definitions yet. Add an Agent to reuse it in your Flows.";
  if (filter.kind !== "all") return "No Agents match your search or owner filter.";
  return searching ? "No Agents match your search." : "No Agents for this owner.";
}

/** The Agents the search and owner filter show, grouped by owner. */
function shownAgentGroups(
  agents: readonly AgentDefinition[] | null,
  query: string,
  { projects, filter }: ReturnType<typeof useStudioOwners>,
) {
  const needle = query.trim().toLocaleLowerCase();
  const matching = agents?.filter((agent) => agent.name.toLocaleLowerCase().includes(needle));
  return {
    groups: matching ? ownerGroups(matching, projects, filter) : null,
    empty: emptyAgentsMessage(agents?.length ?? 0, Boolean(needle), filter),
  };
}

function AgentListRows({
  agents,
  query,
  owners,
  flows,
  capabilities,
  selectedId,
  error,
  loading,
}: {
  agents: readonly AgentDefinition[] | null;
  query: string;
  owners: ReturnType<typeof useStudioOwners>;
  flows: readonly FlowDraft[] | null;
  capabilities: AgentCapabilities | null;
  selectedId: string | undefined;
  error: string;
  loading: boolean;
}) {
  const { groups, empty } = shownAgentGroups(agents, query, owners);
  return error ? (
    <Alert variant="destructive" className="mb-2">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : loading ? (
    <p role="status" className="px-1 py-4 text-sm text-muted-foreground">
      Loading Agents…
    </p>
  ) : groups && groups.length === 0 ? (
    <p className="px-1 py-4 text-sm text-muted-foreground">{empty}</p>
  ) : (
    groups?.map((group) => (
      <AgentOwnerSection
        key={group.owner.projectId ?? "global"}
        group={group}
        flows={flows}
        capabilities={capabilities}
        selectedId={selectedId}
      />
    ))
  );
}

/** One owner's Agents under its section label, as Figma P03 groups them. */
function AgentOwnerSection({
  group: { owner, items },
  flows,
  capabilities,
  selectedId,
}: {
  group: OwnerGroup<AgentDefinition>;
  flows: readonly FlowDraft[] | null;
  capabilities: AgentCapabilities | null;
  selectedId: string | undefined;
}) {
  return (
    <section aria-label={ownerName(owner)}>
      <h3
        className={cn(
          sectionLabelClass,
          "flex min-w-0 items-baseline gap-2 px-2 pt-1.5 pb-1",
          owner.unavailable && "text-attention",
        )}
        title={owner.unavailable ?? owner.detail ?? undefined}
      >
        <span className="shrink-0">{ownerName(owner)}</span>
        {owner.detail && (
          <OwnerPath
            path={owner.detail}
            className="font-normal tracking-label text-subtle-foreground normal-case"
          />
        )}
      </h3>
      <ul className="grid gap-1 pb-2">
        {items.map((agent) => (
          <li key={agent.id}>
            <AgentListItemLink
              id={agent.id}
              name={agent.name}
              meta={
                agent.execution ? (
                  [
                    agentRuntimeMeta(agent.execution, capabilities),
                    projectOverridesLabel(agent.projectOverrides.length),
                  ]
                    .filter(Boolean)
                    .join(" · ")
                ) : (
                  <NeedsModel />
                )
              }
              {...(agent.execution ? { providerId: agent.execution.providerInstanceId } : {})}
              overrides={projectOverridesLabel(agent.projectOverrides.length)}
              usage={flowUsageLabel(flowUsageCount(flows ?? [], agent.id))}
              selected={selectedId === agent.id}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function AgentListItemLink({
  id,
  name,
  meta,
  overrides,
  usage,
  selected,
  providerId,
}: {
  id: string;
  name: string;
  meta: ReactNode;
  /** "+N Project overrides", kept beside a reporting problem that replaces the summary. */
  overrides?: string;
  usage?: string;
  selected: boolean;
  providerId?: string;
}) {
  const reporting = useReportingState();
  const status = providerId ? agentReportingStatus(providerId, reporting) : undefined;
  const attention = status?.state === "attention" ? status : undefined;
  return (
    <StudioLink
      selection={{ tab: "agents", agentId: id }}
      aria-label={name}
      aria-describedby={attention ? `agent-reporting-${id}` : undefined}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "flex min-w-0 w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-foreground no-underline outline-none transition-colors hover:no-underline focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected
          ? "border border-primary bg-sidebar-accent"
          : "border border-transparent hover:bg-accent",
      )}
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
        <Bot aria-hidden className="size-4" strokeWidth={1.5} />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-sm font-medium">{name}</span>
        {/* Figma SA01: reporting that needs attention takes the summary's line, keeping the override
            count; healthy says nothing. */}
        {attention ? (
          <span
            id={`agent-reporting-${id}`}
            className="flex min-w-0 items-center gap-1.5 text-2xs text-attention"
          >
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-attention" />
            <span className="truncate">{attention.label}</span>
            {overrides && <span className="shrink-0 text-subtle-foreground">· {overrides}</span>}
          </span>
        ) : (
          <span className="truncate text-2xs text-subtle-foreground">{meta}</span>
        )}
      </span>
      {usage && (
        <span className="shrink-0 text-2xs font-medium text-muted-foreground">{usage}</span>
      )}
    </StudioLink>
  );
}
