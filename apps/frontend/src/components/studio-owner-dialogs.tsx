import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import type {
  AgentDefinition,
  FactoryProject,
  FlowDraft,
  FlowDuplicatePlanAgent,
} from "@t3-factory/contracts";
import { Bot, ChevronRight, TriangleAlert, Workflow } from "lucide-react";
import { MutationGate } from "@/client-gate";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
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
import { OwnerTargetMenu } from "./studio-owner.tsx";

/** The definition a dialog acts on, with the owning Project its editor shows now. */
interface DialogSubject {
  readonly id: string;
  readonly name: string;
  readonly projectId: string | null;
}

type Kind = "Flow" | "Agent";

const hintClass = "text-2xs tracking-label text-subtle-foreground";

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

/** "Global" or "owned by Northwind", for sentences about a target. */
const ownedBy = (projectId: string | null, projects: readonly FactoryProject[]) =>
  projectId === null ? "Global" : `owned by ${studioOwner(projectId, projects).title}`;

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
  duplicateBlocked,
}: {
  kind: Kind;
  subject: DialogSubject;
  definitions: StudioDefinitions;
  onClose: () => void;
  /** The definition now has owning Project `projectId`. */
  onChanged: (moved: OwnerMove) => void;
  /** Opens Duplicate with `target` preselected, the alternative to a refused move. */
  onDuplicateInstead: (target: string | null) => void;
  /** Why Duplicate is not offered now, such as unsaved Agent changes. */
  duplicateBlocked?: string | undefined;
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
        duplicateBlocked={duplicateBlocked}
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

/** Figma P04: the refused move, its blocking definitions and Duplicate into the target. */
function ChangeOwnerRefusal({
  kind,
  subject,
  target,
  blockers,
  projects,
  duplicateBlocked,
  onCancel,
  onDuplicate,
}: {
  kind: Kind;
  subject: DialogSubject;
  target: string | null;
  blockers: readonly OwnerChangeBlocker[];
  projects: readonly FactoryProject[];
  duplicateBlocked: string | undefined;
  onCancel: () => void;
  onDuplicate: () => void;
}) {
  const title = studioOwner(target, projects).title;
  const asOwner = target === null ? "Global" : `a ${title}`;
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
            <Button
              type="button"
              disabled={Boolean(duplicateBlocked)}
              title={duplicateBlocked}
              onClick={onDuplicate}
            >
              Duplicate to {title}…
            </Button>
          </MutationGate>
        </>
      }
    >
      <Alert variant="attention" className="px-3 py-2.5">
        <TriangleAlert aria-hidden strokeWidth={1.5} />
        <AlertTitle>
          {kind === "Agent"
            ? `Flows outside ${title} place this Agent`
            : `This Flow places Agents ${target === null ? "a global Flow" : title} can’t place`}
        </AlertTitle>
        <AlertDescription>
          {kind === "Agent"
            ? `A Project Agent can only be placed by Flows of its owning Project. Remove it from these Flows first, or duplicate it into ${title} instead.`
            : `Remove these Agents from the Flow first, or duplicate it into ${title} instead; Duplicate copies the Agents the target can’t place.`}
        </AlertDescription>
      </Alert>
      <ul
        aria-label={kind === "Agent" ? "Blocking Flows" : "Blocking Agents"}
        className="grid gap-0.5 rounded-lg border bg-muted px-2 py-1.5"
      >
        {blockers.map((blocker) => (
          <BlockerRow
            key={blocker.message}
            blocker={blocker}
            subjectId={subject.id}
            projects={projects}
          />
        ))}
      </ul>
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
      block.kind === "agent" && block.agentId === subjectId ? [block.name] : [],
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
        className="flex w-full items-center gap-2 rounded-sm py-1.5 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
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

/** What Flow Duplicate does with one Agent, in words. */
function planAgentMeta(
  agent: FlowDuplicatePlanAgent,
  target: string | null,
  projects: readonly FactoryProject[],
) {
  const targetTitle = studioOwner(target, projects).title;
  if (agent.projectId === null)
    return agent.choice === "keep"
      ? "Global Agent · stays shared — edits affect every Flow using it"
      : `Global Agent → new ${target === null ? "global" : targetTitle} copy (own model/prompt)`;
  const ownerTitle = studioOwner(agent.projectId, projects).title;
  return agent.choice === "copy"
    ? `${ownerTitle} Agent · can’t be placed in ${targetTitle}`
    : `${ownerTitle} Agent · already owned by the target`;
}

/** Figma Studio/DuplicateAgentRow: keep or copy a global Agent; fixed choices as a tag. */
function DuplicateAgentRow({
  agent,
  target,
  projects,
  disabled,
  onChoose,
}: {
  agent: FlowDuplicatePlanAgent;
  target: string | null;
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
          {planAgentMeta(agent, target, projects)}
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
        <span className="shrink-0 rounded-sm border border-brand-cyan bg-accent px-2 py-1 text-2xs leading-none font-medium text-brand-cyan">
          Copied into target
        </span>
      ) : (
        <span className="shrink-0 rounded-sm border bg-accent px-2 py-1 text-2xs leading-none font-medium text-muted-foreground">
          Kept
        </span>
      )}
    </li>
  );
}

/** What committing the plan creates, and that the source stays as it is. */
function duplicateSummary(
  state: FlowDuplicateSnapshot,
  source: DialogSubject,
  projects: readonly FactoryProject[],
) {
  const copies = state.plan?.agents.filter((agent) => agent.choice === "copy").length ?? 0;
  const agents = copies === 0 ? "" : ` and ${copies} ${copies === 1 ? "Agent" : "Agents"}`;
  const owner = state.target === null ? "as global definitions" : ownedBy(state.target, projects);
  const unchanged =
    source.projectId === null
      ? "The source Flow and its Agents don’t change."
      : `Nothing in ${studioOwner(source.projectId, projects).title} changes.`;
  return `Creates 1 Flow${agents} ${owner}. ${unchanged}`;
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
      description={
        dirty ? `Copies saved revision ${revision} without your unsaved changes.` : undefined
      }
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
      <OwnerTargetMenu
        label="Target owner"
        chosen={state.target}
        from={source.projectId}
        projects={projects}
        disabled={busy}
        onChange={(target) => void model.setTarget(target)}
        unavailableReason=" — can’t own copies"
      />
      <div className="grid gap-1.5">
        <span id="duplicate-flow-agents" className={fieldLabelClass}>
          Agents in this Flow
        </span>
        <DuplicatePlan state={state} projects={projects} disabled={busy} onChoose={model.choose} />
      </div>
      {state.plan && <p className={hintClass}>{duplicateSummary(state, source, projects)}</p>}
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
  const box = "rounded-md border bg-background p-1";
  if (!state.plan)
    return (
      <p role="status" className={cn(box, "px-2.5 py-3 text-sm text-muted-foreground")}>
        {state.previewing ? "Preparing the plan…" : "No plan yet."}
      </p>
    );
  if (state.plan.agents.length === 0)
    return (
      <p className={cn(box, "px-2.5 py-3 text-sm text-muted-foreground")}>
        This Flow places no Agents.
      </p>
    );
  return (
    <ul aria-labelledby="duplicate-flow-agents" className={cn(box, "grid gap-0.5")}>
      {state.plan.agents.map((agent) => (
        <DuplicateAgentRow
          key={agent.agentId}
          agent={agent}
          target={state.target}
          projects={projects}
          disabled={disabled}
          onChoose={(choice) => onChoose(agent.agentId, choice)}
        />
      ))}
    </ul>
  );
}

/**
 * Agent Duplicate into a target owner, defaulting to the source's owning Project. An unavailable
 * default, as when rescuing an Agent from an unavailable Project, must be changed first.
 */
export function DuplicateAgentDialog({
  source,
  projects,
  initialTarget,
  duplicating,
  error,
  onClose,
  onDuplicate,
}: {
  source: DialogSubject;
  projects: readonly FactoryProject[];
  initialTarget?: string | null | undefined;
  duplicating: boolean;
  error: string;
  onClose: () => void;
  onDuplicate: (target: string | null) => void;
}) {
  const [target, setTarget] = useState(
    initialTarget === undefined ? source.projectId : initialTarget,
  );
  const blocked = ownerPicker(target, projects).blocked;
  return (
    <OwnerDialog
      busy={duplicating}
      onClose={onClose}
      title={<>Duplicate “{source.name}”</>}
      description={changeOwnerRule("Agent", target, projects)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!blocked && !duplicating) onDuplicate(target);
      }}
      actions={
        <>
          <Button type="button" variant="outline" disabled={duplicating} onClick={onClose}>
            Cancel
          </Button>
          <MutationGate>
            <Button type="submit" disabled={duplicating || Boolean(blocked)}>
              {duplicating ? "Duplicating…" : "Duplicate"}
            </Button>
          </MutationGate>
        </>
      }
    >
      <OwnerTargetMenu
        label="Target owner"
        chosen={target}
        from={source.projectId}
        projects={projects}
        disabled={duplicating}
        onChange={setTarget}
        unavailableReason=" — can’t own copies"
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </OwnerDialog>
  );
}
