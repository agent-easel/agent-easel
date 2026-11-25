import { useMutationsAllowed } from "@/client-gate";
import { Bot, FolderGit2, Trash2 } from "lucide-react";
import type { AgentCapabilities, AgentDefinition, FlowDraft } from "@agent-easel/contracts";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import {
  agentRuntimeMeta,
  flowUsageLabel,
  placingFlows,
  projectOverridesLabel,
} from "@/lib/agent-display";
import { StatusBadge } from "../status-badge.tsx";
import { NeedsModel } from "../needs-model.tsx";
import { OwnerGroupHeader } from "../studio-owner.tsx";
import { StudioListMessage, StudioListRow, StudioRowIcon, StudioRowMenu } from "../studio-list.tsx";
import {
  allOwners,
  ownerGroups,
  shownByFilter,
  type OwnerGroup,
  type StudioOwner,
  type StudioOwnerFilter,
  type useStudioOwners,
} from "../../studio-definitions.ts";
import { agentReportingStatus, useReportingState } from "../../reporting-state.tsx";

export function AgentsListColumn({
  agents,
  flows,
  capabilities,
  owners,
  selectedId,
  query,
  creatingNew,
  error,
  onChangeOwner,
  onRemove,
}: {
  agents: readonly AgentDefinition[] | null;
  flows: readonly FlowDraft[] | null;
  capabilities: AgentCapabilities | null;
  owners: ReturnType<typeof useStudioOwners>;
  selectedId: string | undefined;
  creatingNew: boolean;
  query: string;
  error: string;
  onChangeOwner: (agent: AgentDefinition) => void;
  onRemove: (agent: AgentDefinition) => void;
}) {
  const groups = shownGroups(agents, query, owners, selectedId);
  return (
    <div className="flex w-full min-w-0 flex-col gap-2 md:w-100 md:shrink-0">
      {creatingNew && (
        <StudioListRow
          icon={
            <StudioRowIcon>
              <Bot aria-hidden className="size-4" strokeWidth={1.5} />
            </StudioRowIcon>
          }
          name="New Agent"
          meta="Draft · not saved yet"
          menu={<span className="size-7" />}
          selection={{ tab: "agents", agentId: "new" }}
          selected={selectedId === "new"}
          wrap
        />
      )}
      <AgentGroups
        agents={agents}
        flows={flows}
        groups={groups}
        error={error}
        capabilities={capabilities}
        selectedId={selectedId}
        onChangeOwner={onChangeOwner}
        onRemove={onRemove}
      />
    </div>
  );
}

function AgentGroups({
  agents,
  flows,
  groups,
  error,
  capabilities,
  selectedId,
  onChangeOwner,
  onRemove,
}: {
  agents: readonly AgentDefinition[] | null;
  flows: readonly FlowDraft[] | null;
  groups: readonly OwnerGroup<AgentDefinition>[];
  error: string;
  capabilities: AgentCapabilities | null;
  selectedId: string | undefined;
  onChangeOwner: (agent: AgentDefinition) => void;
  onRemove: (agent: AgentDefinition) => void;
}) {
  if (error) return <StudioListMessage tone="error">Couldn’t load Agents.</StudioListMessage>;
  if (agents === null || flows === null)
    return <StudioListMessage tone="muted">Loading Agents…</StudioListMessage>;
  if (groups.length === 0) {
    const text = agents.length === 0 ? "No Agents yet" : "No matching Agents";
    return <StudioListMessage tone="muted">{text}</StudioListMessage>;
  }
  return groups.map((group) => (
    <AgentOwnerSection
      key={group.owner.projectId ?? "global"}
      group={group}
      flows={flows}
      capabilities={capabilities}
      selectedId={selectedId}
      onChangeOwner={onChangeOwner}
      onRemove={onRemove}
    />
  ));
}

/** The first Agent the page selects: Global first, skipping a Project gone from T3. */
export function firstOpenAgent(
  agents: readonly AgentDefinition[] | null,
  query: string,
  owners: ReturnType<typeof useStudioOwners>,
) {
  return shownGroups(agents, query, owners).find((group) => !group.owner.gone)?.items[0]?.id;
}

/**
 * The Agents the search and Owner filter show, grouped by owner. The open Agent stays listed under
 * its owner even when they would hide it: the editor has no owner line, so its group heading is
 * where the owner and the placement rule are read.
 */
function shownGroups(
  agents: readonly AgentDefinition[] | null,
  query: string,
  { projects, filter }: ReturnType<typeof useStudioOwners>,
  selectedId?: string,
) {
  const needle = query.trim().toLocaleLowerCase();
  const shown = agents?.filter(
    (agent) =>
      agent.id === selectedId ||
      (agent.name.toLocaleLowerCase().includes(needle) && shownByFilter(agent.projectId, filter)),
  );
  return shown ? ownerGroups(shown, projects, allOwners) : [];
}

function AgentOwnerSection({
  group: { owner, items },
  flows,
  capabilities,
  selectedId,
  onChangeOwner,
  onRemove,
}: {
  group: OwnerGroup<AgentDefinition>;
  flows: readonly FlowDraft[];
  capabilities: AgentCapabilities | null;
  selectedId: string | undefined;
  onChangeOwner: (agent: AgentDefinition) => void;
  onRemove: (agent: AgentDefinition) => void;
}) {
  const count = `${items.length} ${items.length === 1 ? "Agent" : "Agents"}`;
  const placedAgents = items.length === 1 ? "this Agent" : "these Agents";
  return (
    <section aria-label={owner.title} className="flex flex-col gap-2">
      <OwnerGroupHeader
        owner={owner}
        count={count}
        placement={
          owner.projectId !== null && !owner.gone
            ? `Only ${owner.title} Flows can place ${placedAgents}.`
            : undefined
        }
      />
      {items.map((agent) => (
        <AgentRow
          key={agent.id}
          agent={agent}
          owner={owner}
          flows={flows}
          capabilities={capabilities}
          selected={selectedId === agent.id}
          onChangeOwner={() => onChangeOwner(agent)}
          onRemove={() => onRemove(agent)}
        />
      ))}
    </section>
  );
}

function AgentRow({
  agent,
  owner,
  flows,
  capabilities,
  selected,
  onChangeOwner,
  onRemove,
}: {
  agent: AgentDefinition;
  owner: StudioOwner;
  flows: readonly FlowDraft[];
  capabilities: AgentCapabilities | null;
  selected: boolean;
  onChangeOwner: () => void;
  onRemove: () => void;
}) {
  const reporting = useReportingState();
  // A saved selection T3 no longer offers reads Needs a model, as the editor shows it.
  const summary = agentRuntimeMeta(agent.execution, capabilities);
  const status =
    agent.execution && summary
      ? agentReportingStatus(agent.execution.providerInstanceId, reporting)
      : undefined;
  const attention = status?.state === "attention" ? status : undefined;
  const overrides = projectOverridesLabel(agent.projectOverrides.length);
  const meta = attention ? (
    <span
      id={`agent-reporting-${agent.id}`}
      className="flex min-w-0 flex-wrap items-center gap-1.5"
    >
      <StatusBadge kind="attention">{attention.label}</StatusBadge>
      {overrides && <span className="text-subtle-foreground">{overrides}</span>}
    </span>
  ) : summary ? (
    [summary, overrides].filter(Boolean).join(" · ")
  ) : (
    <NeedsModel />
  );
  return (
    <StudioListRow
      icon={
        <StudioRowIcon>
          <Bot aria-hidden className="size-4" strokeWidth={1.5} />
        </StudioRowIcon>
      }
      name={agent.name}
      meta={meta}
      wrap
      selected={selected}
      trailing={
        <span className="shrink-0 text-2xs text-subtle-foreground">
          {flowUsageLabel(placingFlows(flows, agent.id).length)}
        </span>
      }
      menu={<AgentRowMenu name={agent.name} onChangeOwner={onChangeOwner} onRemove={onRemove} />}
      selection={owner.gone ? undefined : { tab: "agents", agentId: agent.id }}
    />
  );
}

function AgentRowMenu({
  name,
  onChangeOwner,
  onRemove,
}: {
  name: string;
  onChangeOwner: () => void;
  onRemove: () => void;
}) {
  const allowed = useMutationsAllowed();
  return (
    <StudioRowMenu label={`${name} actions`} tooltip="Agent actions">
      <DropdownMenuItem disabled={!allowed} onSelect={onChangeOwner}>
        <FolderGit2 aria-hidden strokeWidth={1.5} />
        Change owner…
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" disabled={!allowed} onSelect={onRemove}>
        <Trash2 aria-hidden strokeWidth={1.5} />
        Remove…
      </DropdownMenuItem>
    </StudioRowMenu>
  );
}

/** Whether the loaded list has nothing to show under the toolbar. */
export function agentsListEmpty(
  agents: readonly AgentDefinition[] | null,
  creatingNew: boolean,
  filter: StudioOwnerFilter,
  query: string,
) {
  if (creatingNew || agents === null || agents.length > 0) return false;
  return filter.kind === "all" && query.trim() === "";
}
