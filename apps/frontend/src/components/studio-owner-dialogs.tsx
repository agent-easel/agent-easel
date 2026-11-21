import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import type {
  AgentDefinition,
  FactoryProject,
  FlowDraft,
  FlowDuplicatePlanAgent,
} from "@t3-factory/contracts";
import { Bot, ChevronRight, Copy, Link, Workflow } from "lucide-react";
import { MutationGate } from "@/client-gate";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Surface } from "@/components/ui/surface";
import { StatusBadge } from "./status-badge.tsx";
import type { OwnerMove } from "../revisioned-draft.ts";
import { useStudioNavigation } from "../settings-navigation.ts";
import {
  createChangeOwner,
  createFlowDuplicate,
  ownerPicker,
  studioOwner,
  useStudioOwners,
  type FlowDuplicateSnapshot,
  type OwnerChangeBlocker,
  type StudioDefinitions,
} from "../studio-definitions.ts";
import { fieldLabelClass } from "./page.tsx";
import { SegmentedChoice } from "./segmented-choice.tsx";
import { OwnerPicker, OwnerTargetMenu } from "./studio-owner.tsx";
import { ProblemCard } from "./problem-card.tsx";

/** The definition a dialog acts on, with the owning Project its editor shows now. */
interface DialogSubject {
  readonly id: string;
  readonly name: string;
  readonly projectId: string | null;
}

type Kind = "Flow" | "Agent";

/** A dialog that cannot be dismissed while its write is pending. */
function OwnerDialog({
  busy,
  onClose,
  ...content
}: React.ComponentProps<typeof DialogContent> & {
  busy: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        {...content}
        closeDisabled={busy}
        // A parent Studio modal must not also take this Escape.
        onKeyDownCapture={(event) => {
          if (event.key === "Escape") event.stopPropagation();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      />
    </Dialog>
  );
}

/** What the new owner means for the moved definition. */
function changeOwnerRule(kind: Kind, target: string | null, projects: readonly FactoryProject[]) {
  if (target === null)
    return kind === "Agent"
      ? "A global Agent can be placed by any Flow."
      : "A global Flow runs in every project and places only global Agents.";
  const { title } = studioOwner(target, projects);
  return kind === "Agent"
    ? `Only ${title} Flows can place a ${title} Agent.`
    : `A ${title} Flow runs only in ${title} and places global Agents and ${title}’s Agents.`;
}

/**
 * Figma P03/P04: **Change owner…** of a Flow or Agent. It moves the definition without a new
 * revision; a refusal names each blocking Flow or Agent and offers Duplicate into the target.
 */
export function ChangeOwnerDialog({
  kind,
  subject,
  definitions,
  onClose,
  onChanged,
  onDuplicateInstead,
}: {
  kind: Kind;
  subject: DialogSubject;
  definitions: StudioDefinitions;
  onClose: () => void;
  /** The definition now has owning Project `projectId`. */
  onChanged: (moved: OwnerMove) => void;
  /** Opens Duplicate with `target` preselected, the alternative to a refused move. */
  onDuplicateInstead: (target: string | null) => void;
}) {
  const { projects } = useStudioOwners(definitions);
  const [model] = useState(() =>
    createChangeOwner(
      { kind: kind === "Flow" ? "flow" : "agent", id: subject.id, expected: subject.projectId },
      definitions,
    ),
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const blocked = ownerPicker(state.target, projects).blocked;
  async function submit(event: FormEvent) {
    event.preventDefault();
    const moved = await model.confirm();
    if (!moved) return;
    onChanged(moved);
    onClose();
  }
  if (state.blockers.length > 0)
    return (
      <ChangeOwnerRefusal
        kind={kind}
        subject={subject}
        target={state.target}
        blockers={state.blockers}
        projects={projects}
        onCancel={onClose}
        onDuplicate={() => onDuplicateInstead(state.target)}
      />
    );
  return (
    <OwnerDialog
      busy={state.changing}
      onClose={onClose}
      title={<>Change owner of “{subject.name}”</>}
      description={changeOwnerRule(kind, state.target, projects)}
      onSubmit={(event) => void submit(event)}
      actions={
        <>
          <Button type="button" variant="outline" disabled={state.changing} onClick={onClose}>
            Cancel
          </Button>
          <MutationGate>
            <Button
              type="submit"
              disabled={state.changing || Boolean(blocked) || state.target === subject.projectId}
            >
              {state.changing ? "Changing…" : "Change owner"}
            </Button>
          </MutationGate>
        </>
      }
    >
      <OwnerTargetMenu
        label="New owner"
        chosen={state.target}
        from={subject.projectId}
        projects={projects}
        disabled={state.changing}
        onChange={model.setTarget}
        unavailableReason=" — can’t own definitions"
      />
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
    </OwnerDialog>
  );
}

function refusalCopy(kind: Kind, title: string, target: string | null, hasFlowBlocker: boolean) {
  if (kind === "Agent")
    return {
      title: `Flows outside ${title} place this Agent`,
      body: `A Project Agent can only be placed by Flows of its owning Project. Remove it from these Flows first, or duplicate it into ${title} instead.`,
      listLabel: "Blocking Flows",
    };
  if (hasFlowBlocker)
    return {
      title: `Other definitions can’t share this Flow under ${target === null ? "Global" : title}`,
      body: `Change these definitions first, or duplicate this Flow into ${title} instead; Duplicate copies the Flows and Agents the target can’t place.`,
      listLabel: "Blocking definitions",
    };
  return {
    title: `This Flow places Agents ${target === null ? "a global Flow" : title} can’t place`,
    body: `Remove these Agents from the Flow first, or duplicate it into ${title} instead; Duplicate copies the Agents the target can’t place.`,
    listLabel: "Blocking Agents",
  };
}

/** Figma P04: the refused move, its blocking definitions and Duplicate into the target. */
function ChangeOwnerRefusal({
  kind,
  subject,
  target,
  blockers,
  projects,
  onCancel,
  onDuplicate,
}: {
  kind: Kind;
  subject: DialogSubject;
  target: string | null;
  blockers: readonly OwnerChangeBlocker[];
  projects: readonly FactoryProject[];
  onCancel: () => void;
  onDuplicate: () => void;
}) {
  const title = studioOwner(target, projects).title;
  const asOwner = target === null ? "Global" : `a ${title}`;
  const hasFlowBlocker = blockers.some(
    (blocker) => blocker.definition !== null && "graph" in blocker.definition,
  );
  const copy = refusalCopy(kind, title, target, hasFlowBlocker);
  return (
    <OwnerDialog
      busy={false}
      onClose={onCancel}
      title={
        <>
          Can’t make “{subject.name}” {asOwner} {kind}
        </>
      }
      actions={
        <>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <MutationGate>
            <Button type="button" onClick={onDuplicate}>
              Duplicate to {title}…
            </Button>
          </MutationGate>
        </>
      }
    >
      <ProblemCard tone="attention" density="compact" title={copy.title}>
        {copy.body}
      </ProblemCard>
      <Surface tone="inset" asChild className="grid gap-0.5 px-2 py-1.5">
        <ul aria-label={copy.listLabel}>
          {blockers.map((blocker) => (
            <BlockerRow
              key={blocker.message}
              blocker={blocker}
              subjectId={subject.id}
              projects={projects}
            />
          ))}
        </ul>
      </Surface>
    </OwnerDialog>
  );
}

/** The blocking definition's owner and where it places or is placed by the subject. */
function blockerDetail(
  definition: FlowDraft | AgentDefinition,
  subjectId: string,
  projects: readonly FactoryProject[],
) {
  const owner =
    definition.projectId === null ? null : studioOwner(definition.projectId, projects).title;
  if ("graph" in definition) {
    const blocks = definition.graph.blocks.flatMap((block) =>
      (block.kind === "agent" && block.agentId === subjectId) ||
      (block.kind === "subflow" && block.flowId === subjectId)
        ? [block.name]
        : [],
    );
    const placing = blocks.length
      ? ` · ${blocks.join(", ")} ${blocks.length === 1 ? "block" : "blocks"}`
      : "";
    return `${owner ? `Owned by ${owner}` : "Global Flow"}${placing}`;
  }
  return `${owner ? `${owner} Agent` : "Global Agent"}`;
}

/** One blocking Flow or Agent; a listed one opens in Studio. */
function BlockerRow({
  blocker,
  subjectId,
  projects,
}: {
  blocker: OwnerChangeBlocker;
  subjectId: string;
  projects: readonly FactoryProject[];
}) {
  const openStudio = useStudioNavigation();
  const { definition } = blocker;
  const Icon = definition && !("graph" in definition) ? Bot : Workflow;
  const text = (
    <>
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
      <span className="grid min-w-0 flex-1 gap-0.5 text-left">
        <span className="truncate text-sm font-medium">{definition?.name ?? blocker.message}</span>
        {definition && (
          <span className="truncate text-2xs tracking-label text-subtle-foreground">
            {blockerDetail(definition, subjectId, projects)}
          </span>
        )}
      </span>
    </>
  );
  if (!definition) return <li className="flex items-center gap-2 py-1.5">{text}</li>;
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm py-1.5 outline-none hover:bg-accent focus-ring"
        onClick={() =>
          void openStudio(
            "graph" in definition
              ? { tab: "flows", flowId: definition.id }
              : { tab: "agents", agentId: definition.id },
          )
        }
      >
        {text}
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.5}
        />
      </button>
    </li>
  );
}

/** Figma Studio/DuplicateAgentRow: keep or copy a global Agent; fixed choices as a tag. */
function DuplicateAgentRow({
  agent,
  projects,
  disabled,
  onChoose,
}: {
  agent: FlowDuplicatePlanAgent;
  projects: readonly FactoryProject[];
  disabled: boolean;
  onChoose: (choice: FlowDuplicatePlanAgent["choice"]) => void;
}) {
  const id = `duplicate-agent-${agent.agentId}`;
  return (
    <li className="flex h-12 items-center gap-2.5 px-2.5 py-2">
      <Bot aria-hidden className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span id={id} className="truncate text-sm font-medium">
          {agent.name}
        </span>
        <span className="truncate text-2xs tracking-label text-subtle-foreground">
          {studioOwner(agent.projectId, projects).title}
        </span>
      </span>
      {agent.changeable ? (
        <fieldset disabled={disabled} className="contents">
          <SegmentedChoice
            size="sm"
            labelledBy={id}
            value={agent.choice}
            options={[
              ["keep", "Keep shared"],
              ["copy", "Copy"],
            ]}
            onChange={onChoose}
          />
        </fieldset>
      ) : agent.choice === "copy" ? (
        <StatusBadge kind="neutral" icon={Copy}>
          Copied
        </StatusBadge>
      ) : (
        <StatusBadge kind="neutral" icon={Link}>
          Kept
        </StatusBadge>
      )}
    </li>
  );
}

/**
 * Figma P05: Flow Duplicate into a target owner with the plan of every Agent the Flow places. It
 * defaults to the source's owning Project; an unavailable target blocks Duplicate until changed.
 */
export function DuplicateFlowDialog({
  source,
  revision,
  dirty,
  definitions,
  initialTarget,
  onClose,
  onDuplicated,
}: {
  source: DialogSubject;
  /** The saved revision a Duplicate copies. */
  revision: number;
  /** The editor has unsaved changes, which a Duplicate leaves out. */
  dirty: boolean;
  definitions: StudioDefinitions;
  /** The preselected target; the source's owning Project when omitted. */
  initialTarget?: string | null | undefined;
  onClose: () => void;
  onDuplicated: (flow: FlowDraft) => void;
}) {
  const { projects } = useStudioOwners(definitions);
  const [model] = useState(() =>
    createFlowDuplicate(
      source,
      definitions,
      initialTarget === undefined ? source.projectId : initialTarget,
    ),
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => {
    void model.preview();
  }, [model]);
  const blocked = ownerPicker(state.target, projects).blocked;
  const busy = state.committing;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (blocked) return;
    const result = await model.confirm();
    if (result) onDuplicated(result.flow);
  }
  return (
    <OwnerDialog
      busy={busy}
      onClose={onClose}
      title={<>Duplicate “{source.name}”</>}
      onSubmit={(event) => void submit(event)}
      actions={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <MutationGate>
            <Button
              type="submit"
              disabled={busy || state.previewing || !state.plan || Boolean(blocked)}
            >
              {busy ? "Duplicating…" : "Duplicate"}
            </Button>
          </MutationGate>
        </>
      }
    >
      {dirty && (
        <ProblemCard tone="info" title={`Copies saved revision ${revision}`}>
          Your unsaved changes aren’t included.
        </ProblemCard>
      )}
      <div className="grid gap-1.5">
        <label htmlFor="duplicate-flow-name" className={fieldLabelClass}>
          Name
        </label>
        <Input
          id="duplicate-flow-name"
          maxLength={200}
          value={state.name}
          disabled={busy}
          onChange={(event) => model.setName(event.target.value)}
        />
      </div>
      <OwnerPicker
        kind="Flow"
        chosen={state.target}
        initial={source.projectId}
        hint=""
        projects={projects}
        disabled={busy}
        onChange={(target) => void model.setTarget(target)}
      />
      {state.plan && state.plan.flows.length > 0 && (
        <div className="grid gap-1.5">
          <span id="duplicate-flow-subflows" className={fieldLabelClass}>
            Flows copied into target
          </span>
          <Surface tone="inset" asChild className="grid gap-0.5 p-1">
            <ul aria-labelledby="duplicate-flow-subflows">
              {state.plan.flows.map((flow) => (
                <li key={flow.flowId} className="flex h-12 items-center gap-2.5 px-2.5 py-2">
                  <Workflow
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate text-sm font-medium">{flow.name}</span>
                    <span className="truncate text-2xs tracking-label text-subtle-foreground">
                      {studioOwner(flow.projectId, projects).title}
                    </span>
                  </span>
                  <StatusBadge kind="neutral" icon={Copy}>
                    Copied
                  </StatusBadge>
                </li>
              ))}
            </ul>
          </Surface>
        </div>
      )}
      <div className="grid gap-1.5">
        <span id="duplicate-flow-agents" className={fieldLabelClass}>
          Agents in this Flow
        </span>
        <DuplicatePlan state={state} projects={projects} disabled={busy} onChoose={model.choose} />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
    </OwnerDialog>
  );
}

function DuplicatePlan({
  state,
  projects,
  disabled,
  onChoose,
}: {
  state: FlowDuplicateSnapshot;
  projects: readonly FactoryProject[];
  disabled: boolean;
  onChoose: (agentId: string, choice: FlowDuplicatePlanAgent["choice"]) => void;
}) {
  const note = "px-2.5 py-3 text-sm text-muted-foreground";
  if (!state.plan)
    return (
      <Surface tone="inset" asChild className={note}>
        <p role="status">{state.previewing ? "Preparing the plan…" : "No plan yet."}</p>
      </Surface>
    );
  if (state.plan.agents.length === 0)
    return (
      <Surface tone="inset" asChild className={note}>
        <p>This Flow places no Agents.</p>
      </Surface>
    );
  return (
    <Surface tone="inset" asChild className="grid gap-0.5 p-1">
      <ul aria-labelledby="duplicate-flow-agents">
        {state.plan.agents.map((agent) => (
          <DuplicateAgentRow
            key={agent.agentId}
            agent={agent}
            projects={projects}
            disabled={disabled}
            onChoose={(choice) => onChoose(agent.agentId, choice)}
          />
        ))}
      </ul>
    </Surface>
  );
}

/**
 * Figma SA06z: Duplicate copies the saved revision as a new Agent with its own name and owner.
 * From an editor with unsaved changes, one card says they are not included.
 */
export function DuplicateAgentDialog({
  source,
  projects,
  initialTarget,
  unsavedRevision,
  duplicating,
  error,
  onClose,
  onDuplicate,
}: {
  source: DialogSubject;
  projects: readonly FactoryProject[];
  initialTarget?: string | null | undefined;
  /** The saved revision copied while the editor holds unsaved changes; absent when clean. */
  unsavedRevision?: number | undefined;
  duplicating: boolean;
  error: string;
  onClose: () => void;
  onDuplicate: (target: string | null, name: string) => void;
}) {
  const [target, setTarget] = useState(
    initialTarget === undefined ? source.projectId : initialTarget,
  );
  const [name, setName] = useState(`${source.name} (copy)`);
  const blocked = ownerPicker(target, projects).blocked;
  const ready = !blocked && name.trim() !== "" && !duplicating;
  return (
    <OwnerDialog
      busy={duplicating}
      onClose={onClose}
      title={<>Duplicate “{source.name}”</>}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onDuplicate(target, name.trim());
      }}
      actions={
        <>
          <Button type="button" variant="outline" disabled={duplicating} onClick={onClose}>
            Cancel
          </Button>
          <MutationGate>
            <Button type="submit" disabled={!ready}>
              {duplicating ? "Duplicating…" : "Duplicate"}
            </Button>
          </MutationGate>
        </>
      }
    >
      <div className="grid gap-1.5">
        <label htmlFor="duplicate-agent-name" className={fieldLabelClass}>
          Name
        </label>
        <Input
          id="duplicate-agent-name"
          maxLength={200}
          value={name}
          disabled={duplicating}
          onChange={(event) => setName(event.target.value)}
          className="bg-muted"
        />
      </div>
      <OwnerPicker
        kind="Agent"
        chosen={target}
        projects={projects}
        onChange={setTarget}
        disabled={duplicating}
        initial={target}
        hint=""
      />
      {unsavedRevision !== undefined && (
        <ProblemCard tone="info" title={`Copies saved revision ${unsavedRevision}`}>
          Your unsaved changes aren’t included.
        </ProblemCard>
      )}
      {error && (
        <ProblemCard tone="error" title="Couldn’t duplicate the Agent">
          {error}
        </ProblemCard>
      )}
    </OwnerDialog>
  );
}
