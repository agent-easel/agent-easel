import { MutationGate, useMutationsAllowed } from "@/client-gate";
import { useState } from "react";
import type {
  FactoryProject,
  FlowDraft,
  TriggerDefinition,
  ValidationIssue,
} from "@agent-easel/contracts";
import { ChevronRight, FolderGit2, Trash2, Workflow } from "lucide-react";
import { ApiError } from "../api.ts";
import { StatusBadge } from "../components/status-badge.tsx";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { DefinitionImportControl } from "../components/definition-import-control.tsx";
import {
  StudioListBody,
  StudioListHeader,
  StudioListRow,
  StudioRowIcon,
  StudioRowMenu,
  editedLabel,
  studioListClass,
} from "../components/studio-list.tsx";
import { OwnerFilter, OwnerGroupHeader } from "../components/studio-owner.tsx";
import { ChangeOwnerDialog, DuplicateFlowDialog } from "../components/studio-owner-dialogs.tsx";
import {
  CantRemoveDialog,
  namedBlockers,
  racedBlockers,
  triggerBlockers,
} from "../components/studio-removal.tsx";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  ownerGroups,
  useStudioOwners,
  useStudioRead,
  type OwnerGroup,
  type StudioDefinitions,
  type StudioOwner,
} from "../studio-definitions.ts";
import { useStudioNavigation } from "../settings-navigation.ts";
import { openImported } from "../definition-import.ts";

const flowCount = (count: number) => `${count} ${count === 1 ? "Flow" : "Flows"}`;

/** The row's readiness. A missing folder wins over the graph; a lost connection is not a row state. */
function flowReason(flow: FlowDraft, owner: StudioOwner) {
  if (owner.folderMissing) return owner.unavailable;
  return flow.readiness.ready ? null : (flow.readiness.issues[0]?.message ?? null);
}

type FlowDialog =
  | { readonly kind: "owner"; readonly flow: FlowDraft }
  | { readonly kind: "duplicate"; readonly flow: FlowDraft; readonly target: string | null }
  | { readonly kind: "remove"; readonly flow: FlowDraft };

export function FlowList({
  definitions,
  onCreate,
}: {
  definitions: StudioDefinitions;
  onCreate: () => void;
}) {
  const openStudio = useStudioNavigation();
  const flows = useStudioRead(definitions, "flows");
  const triggers = useStudioRead(definitions, "triggers").value;
  const { projects, filter, setFilter } = useStudioOwners(definitions);
  const items = flows.value;
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<FlowDialog | null>(null);
  const matching =
    items?.filter((flow) =>
      flow.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    ) ?? null;
  const groups = matching && ownerGroups(matching, projects, filter);
  const loaded = items !== null;
  const noMatch = loaded && items.length > 0 && groups?.length === 0;
  return (
    <main className={studioListClass}>
      <StudioListHeader
        title="Flows"
        count={loaded ? items.length : null}
        query={query}
        onQueryChange={setQuery}
        onCreate={onCreate}
        createLabel="New Flow"
        importer={
          <DefinitionImportControl
            projects={projects}
            onImported={(result) => void openImported(result, definitions, openStudio)}
          />
        }
        filter={<OwnerFilter filter={filter} projects={projects} onChange={setFilter} />}
      />
      <StudioListBody
        error={Boolean(flows.error)}
        loaded={loaded}
        noMatch={noMatch}
        empty={Boolean(groups && groups.length === 0)}
        errorText="Couldn’t load Flows."
        loadingText="Loading Flows…"
        noMatchText="No matching Flows"
        emptyIcon={Workflow}
        emptyTitle="No Flows yet"
      >
        <FlowGroups
          groups={groups ?? []}
          onChangeOwner={(flow) => setDialog({ kind: "owner", flow })}
          onRemove={(flow) => setDialog({ kind: "remove", flow })}
        />
      </StudioListBody>
      <FlowListDialogs
        dialog={dialog}
        definitions={definitions}
        projects={projects}
        triggers={triggers ?? []}
        onClose={() => setDialog(null)}
        onDuplicate={(flow, target) => setDialog({ kind: "duplicate", flow, target })}
      />
    </main>
  );
}

function FlowGroups({
  groups,
  onChangeOwner,
  onRemove,
}: {
  groups: readonly OwnerGroup<FlowDraft>[];
  onChangeOwner: (flow: FlowDraft) => void;
  onRemove: (flow: FlowDraft) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {groups.map(({ owner, items }) => (
        <section
          key={owner.projectId ?? "global"}
          aria-label={owner.title}
          className="flex flex-col gap-2"
        >
          <OwnerGroupHeader owner={owner} count={flowCount(items.length)} />
          {items.map((flow) => (
            <FlowRow
              key={flow.id}
              flow={flow}
              owner={owner}
              onChangeOwner={() => onChangeOwner(flow)}
              onRemove={() => onRemove(flow)}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function FlowRow({
  flow,
  owner,
  onChangeOwner,
  onRemove,
}: {
  flow: FlowDraft;
  owner: StudioOwner;
  onChangeOwner: () => void;
  onRemove: () => void;
}) {
  const reason = owner.gone ? null : flowReason(flow, owner);
  const blocks = flow.graph.blocks.length;
  return (
    <StudioListRow
      icon={
        <StudioRowIcon>
          <Workflow aria-hidden className="size-4" strokeWidth={1.5} />
        </StudioRowIcon>
      }
      name={flow.name}
      meta={`${blocks} ${blocks === 1 ? "block" : "blocks"} · Revision ${flow.revision}`}
      reason={reason}
      badge={
        owner.gone ? undefined : reason === null ? (
          <StatusBadge kind="success">Ready</StatusBadge>
        ) : (
          <StatusBadge kind="error">Not ready</StatusBadge>
        )
      }
      trailing={
        <span className="shrink-0 text-2xs text-subtle-foreground">
          {editedLabel(flow.updatedAt)}
        </span>
      }
      menu={<FlowRowMenu name={flow.name} onChangeOwner={onChangeOwner} onRemove={onRemove} />}
      selection={owner.gone ? undefined : { tab: "flows", flowId: flow.id }}
      chevron={
        owner.gone ? null : (
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.5}
          />
        )
      }
    />
  );
}

function FlowRowMenu({
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
    <StudioRowMenu label={`${name} actions`} tooltip="Flow actions">
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

function FlowListDialogs({
  dialog,
  definitions,
  projects,
  triggers,
  onClose,
  onDuplicate,
}: {
  dialog: FlowDialog | null;
  definitions: StudioDefinitions;
  projects: readonly FactoryProject[];
  triggers: readonly TriggerDefinition[];
  onClose: () => void;
  onDuplicate: (flow: FlowDraft, target: string | null) => void;
}) {
  const openStudio = useStudioNavigation();
  if (!dialog) return null;
  const subject = { id: dialog.flow.id, name: dialog.flow.name, projectId: dialog.flow.projectId };
  if (dialog.kind === "owner")
    return (
      <ChangeOwnerDialog
        kind="Flow"
        subject={subject}
        definitions={definitions}
        onClose={onClose}
        onChanged={onClose}
        onDuplicateInstead={(target) => onDuplicate(dialog.flow, target)}
      />
    );
  if (dialog.kind === "duplicate")
    return (
      <DuplicateFlowDialog
        source={subject}
        revision={dialog.flow.revision}
        dirty={false}
        definitions={definitions}
        initialTarget={dialog.target}
        onClose={onClose}
        onDuplicated={(flow) => {
          onClose();
          void openStudio({ tab: "flows", flowId: flow.id });
        }}
      />
    );
  return (
    <FlowRemoveDialog
      flow={dialog.flow}
      projects={projects}
      triggers={triggers.filter((trigger) => trigger.flowId === dialog.flow.id)}
      definitions={definitions}
      onClose={onClose}
    />
  );
}

function FlowRemoveDialog({
  flow,
  projects,
  triggers,
  definitions,
  onClose,
}: {
  flow: FlowDraft;
  projects: readonly FactoryProject[];
  triggers: readonly TriggerDefinition[];
  definitions: StudioDefinitions;
  onClose: () => void;
}) {
  const openStudio = useStudioNavigation();
  const [removing, setRemoving] = useState(false);
  const [issues, setIssues] = useState<readonly ValidationIssue[]>([]);
  const [error, setError] = useState("");
  const raced = namedBlockers(issues, "flow_in_use").filter(
    (blocker) => !triggers.some((trigger) => trigger.id === blocker.id),
  );
  if (triggers.length > 0 || raced.length > 0)
    return (
      <CantRemoveDialog open name={flow.name} label="Triggers" onClose={onClose}>
        {triggerBlockers(
          triggers,
          projects,
          (id) => void openStudio({ tab: "triggers", triggerId: id }),
        )}
        {racedBlockers(
          raced,
          "Trigger",
          (id) => void openStudio({ tab: "triggers", triggerId: id }),
        )}
      </CantRemoveDialog>
    );
  async function confirm() {
    setRemoving(true);
    setError("");
    try {
      await definitions.removeFlow(flow.id);
      onClose();
    } catch (cause) {
      setIssues(cause instanceof ApiError ? cause.detail.issues : []);
      setError(cause instanceof Error ? cause.message : "Factory could not remove this Flow.");
      setRemoving(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !removing) onClose();
      }}
    >
      <DialogContent
        title={<>Remove “{flow.name}”?</>}
        description="Removing this Flow keeps its saved revisions for existing Runs."
        closeDisabled={removing}
        actions={
          <>
            <Button type="button" variant="outline" disabled={removing} onClick={onClose}>
              Cancel
            </Button>
            <MutationGate>
              <Button
                type="button"
                variant="destructive"
                disabled={removing}
                onClick={() => void confirm()}
              >
                {removing ? "Removing…" : "Remove Flow"}
              </Button>
            </MutationGate>
          </>
        }
      >
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
