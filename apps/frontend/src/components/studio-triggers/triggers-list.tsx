import { StartedRuns } from "./started-runs.tsx";
import { useRef, useState } from "react";
import { ChevronRight, Pencil, RefreshCw, Trash2, Zap } from "lucide-react";
import type {
  FactoryProject,
  TriggerCheckReply,
  TriggerDefinition,
  TriggerStartedRun,
} from "@agent-easel/contracts";
import { MutationGate, useMutationsAllowed } from "@/client-gate";
import { ProblemCard } from "../problem-card.tsx";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "../status-badge.tsx";
import { RemoveTriggerDialog } from "./remove-trigger-dialog.tsx";
import type { CheckOutcome, RevisionRefusal, TriggerActions } from "./trigger-actions.ts";
import { TriggerReviewDialog, type TriggerReview } from "./trigger-review-dialog.tsx";
import { reviewSummary, scheduleText, triggerRoute, type TriggerNames } from "./trigger-text.ts";
import { useStudioNavigation } from "../../settings-navigation.ts";
import { ownerGroups, type StudioRead } from "../../studio-definitions.ts";
import { OwnerGroupHeader } from "../studio-owner.tsx";
import {
  StudioListBody,
  StudioListHeader,
  StudioListRow,
  StudioRowIcon,
  StudioRowMenu,
  studioListClass,
} from "../studio-list.tsx";

const refusalNotice = (revision: number, refused: RevisionRefusal) =>
  refused === "enable"
    ? `Revision ${revision} was saved after your review, so nothing was enabled. Review these settings before enabling.`
    : `Revision ${revision} was saved after the revision you checked, so nothing was checked. Review these settings before checking.`;

export interface ReviewOptions {
  readonly refused?: RevisionRefusal;
  readonly onChecked?: (reply: TriggerCheckReply) => void;
}

const triggerReview = (
  trigger: TriggerDefinition,
  names: TriggerNames,
  actions: TriggerActions,
  refused: RevisionRefusal | undefined,
): TriggerReview => ({
  title: refused === "check" ? `Check “${trigger.name}”?` : `Enable “${trigger.name}”?`,
  summary: reviewSummary(trigger, trigger.github.repository.nameWithOwner, names),
  repository: trigger.github.repository.nameWithOwner,
  confirmLabel: refused === "check" ? "Check now" : "Enable and check",
  load: () => actions.preview(trigger),
  ...(refused && { notice: refusalNotice(trigger.revision, refused) }),
});

export function useEnableReview(names: TriggerNames, actions: TriggerActions) {
  const [reviewing, setReviewing] = useState<{
    readonly trigger: TriggerDefinition;
    readonly review: TriggerReview;
    readonly options: ReviewOptions;
  } | null>(null);
  const busy = reviewing !== null && actions.state.pending.has(reviewing.trigger.id);
  const open = (trigger: TriggerDefinition, options: ReviewOptions = {}) =>
    setReviewing({
      trigger,
      options,
      review: triggerReview(trigger, names, actions, options.refused),
    });
  const settle = (outcome: CheckOutcome | undefined, options: ReviewOptions) => {
    if (outcome && "refused" in outcome)
      return open(outcome.latest, { ...options, refused: outcome.refused });
    if (outcome) options.onChecked?.(outcome.checked);
    setReviewing(null);
  };
  /** Enable and check `trigger` at the reviewed `revision`, or review it again if it changed. */
  const enable = (trigger: TriggerDefinition, revision: number, options: ReviewOptions = {}) =>
    actions.enableAndCheck(trigger, revision).then((outcome) => settle(outcome, options));
  return {
    open,
    enable,
    dialog: (
      <TriggerReviewDialog
        review={reviewing?.review ?? null}
        busy={busy}
        onCancel={() => setReviewing(null)}
        onConfirm={(preview) => {
          if (!reviewing) return;
          const { trigger, options } = reviewing;
          const refused = options.refused ?? "enable";
          // A preview that did not show a saved revision cannot confirm one: review again.
          if (preview.revision === null) return open(trigger, { ...options, refused });
          if (refused === "enable") return void enable(trigger, preview.revision, options);
          void actions.run(trigger, preview.revision).then((outcome) => settle(outcome, options));
        }}
      />
    ),
  };
}

type Started = ReadonlyMap<string, readonly TriggerStartedRun[]>;

/** Figma T01/T02: Triggers grouped by Project, with Search and Check now on every row. */
export function TriggersList({
  triggers,
  names,
  projects,
  actions,
  onEnable,
}: {
  triggers: StudioRead<readonly TriggerDefinition[]>;
  names: TriggerNames;
  projects: readonly FactoryProject[];
  actions: TriggerActions;
  onEnable: (trigger: TriggerDefinition, options?: ReviewOptions) => void;
}) {
  const openStudio = useStudioNavigation();
  const create = () => void openStudio({ tab: "triggers", triggerId: "new" });
  const items = triggers.value;
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState<TriggerDefinition | null>(null);
  const menuButton = useRef<HTMLElement | null>(null);
  const [started, setStarted] = useState<Started>(() => new Map());
  const { failure, pending } = actions.state;
  const needle = query.trim().toLocaleLowerCase();
  const matching = items?.filter((trigger) => trigger.name.toLocaleLowerCase().includes(needle));
  const groups = matching ? ownerGroups(matching, projects, { kind: "all" }) : [];
  const loaded = items !== null;
  const noMatch = loaded && items.length > 0 && groups.length === 0;
  const remember = (trigger: TriggerDefinition) => (reply: TriggerCheckReply) =>
    rememberCheck(setStarted, trigger.id, reply);
  const checked = (trigger: TriggerDefinition) =>
    void actions.run(trigger).then((outcome) => {
      if (!outcome) return;
      if ("refused" in outcome)
        return onEnable(outcome.latest, { refused: outcome.refused, onChecked: remember(trigger) });
      remember(trigger)(outcome.checked);
    });
  return (
    <main className={studioListClass}>
      <StudioListHeader
        title="Triggers"
        count={loaded ? items.length : null}
        query={query}
        onQueryChange={setQuery}
        onCreate={create}
        createLabel="New Trigger"
      />
      {failure && <ProblemCard tone="error" title={`${failure.name}: ${failure.message}`} />}
      <StudioListBody
        error={Boolean(triggers.error)}
        loaded={loaded}
        noMatch={noMatch}
        empty={groups.length === 0}
        errorText="Couldn’t load Triggers."
        loadingText="Loading Triggers…"
        noMatchText="No matching Triggers"
        emptyIcon={Zap}
        emptyTitle="No Triggers yet"
      >
        <div className="flex flex-col gap-2">
          {groups.map(({ owner, items: group }) => (
            <section
              key={owner.projectId ?? "global"}
              aria-label={owner.title}
              className="flex flex-col gap-2"
            >
              <OwnerGroupHeader
                owner={owner}
                count={`${group.length} ${group.length === 1 ? "Trigger" : "Triggers"}`}
              />
              {group.map((trigger) => (
                <TriggerRow
                  key={trigger.id}
                  trigger={trigger}
                  names={names}
                  gone={owner.gone}
                  busy={pending.has(trigger.id)}
                  checking={pending.get(trigger.id) === "run"}
                  started={started.get(trigger.id)}
                  actions={actions}
                  onEnable={() => onEnable(trigger, { onChecked: remember(trigger) })}
                  onCheck={() => checked(trigger)}
                  onRemove={(opener) => {
                    menuButton.current = opener;
                    setRemoving(trigger);
                  }}
                />
              ))}
            </section>
          ))}
        </div>
      </StudioListBody>
      <RemoveTriggerDialog
        trigger={removing}
        removing={removing !== null && pending.get(removing.id) === "remove"}
        returnFocus={menuButton}
        onCancel={() => setRemoving(null)}
        onRemove={(trigger) =>
          void actions.remove(trigger).then((removed) => {
            if (removed) setRemoving(null);
          })
        }
      />
    </main>
  );
}

function rememberCheck(
  setStarted: (update: (current: Started) => Started) => void,
  triggerId: string,
  reply: TriggerCheckReply,
) {
  setStarted((current) => {
    const next = new Map(current);
    if (reply.error) next.delete(triggerId);
    else next.set(triggerId, reply.startedRuns);
    return next;
  });
}

function TriggerRow({
  trigger,
  names,
  gone,
  busy,
  checking,
  started,
  actions,
  onEnable,
  onCheck,
  onRemove,
}: {
  trigger: TriggerDefinition;
  names: TriggerNames;
  gone: boolean;
  busy: boolean;
  checking: boolean;
  started: readonly TriggerStartedRun[] | undefined;
  actions: TriggerActions;
  onEnable: () => void;
  onCheck: () => void;
  onRemove: (opener: HTMLButtonElement | null) => void;
}) {
  const openStudio = useStudioNavigation();
  const mutationsAllowed = useMutationsAllowed();
  const edit = { tab: "triggers" as const, triggerId: trigger.id };
  const problem = !gone && trigger.error ? trigger.error.message : null;
  return (
    <StudioListRow
      icon={
        <StudioRowIcon>
          <Zap aria-hidden className="size-4" strokeWidth={1.5} />
        </StudioRowIcon>
      }
      name={trigger.name}
      {...triggerMeta(trigger, names, checking, started)}
      reason={problem}
      badge={problem ? <StatusBadge kind="problem" /> : undefined}
      control={
        gone ? undefined : (
          <MutationGate>
            <Switch
              aria-label={trigger.name}
              checked={trigger.enabled}
              disabled={busy}
              onCheckedChange={(enabled) => (enabled ? onEnable() : void actions.disable(trigger))}
            />
          </MutationGate>
        )
      }
      menu={
        <TriggerRowMenu
          trigger={trigger}
          gone={gone}
          busy={busy}
          mutationsAllowed={mutationsAllowed}
          onCheck={onCheck}
          onEdit={() => void openStudio(edit)}
          onRemove={onRemove}
        />
      }
      selection={gone ? undefined : edit}
      chevron={
        gone ? null : (
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

function triggerMeta(
  trigger: TriggerDefinition,
  names: TriggerNames,
  checking: boolean,
  started: readonly TriggerStartedRun[] | undefined,
) {
  if (checking) return { meta: "Checking…" };
  if (started)
    return started.length
      ? { meta: null, metaAction: <StartedRuns runs={started} /> }
      : { meta: "Nothing ready to start" };
  return {
    meta: `GitHub Issues · ${triggerRoute(trigger, names)} · ${scheduleText(trigger.schedule)}`,
  };
}

function TriggerRowMenu({
  trigger,
  gone,
  busy,
  mutationsAllowed,
  onCheck,
  onEdit,
  onRemove,
}: {
  trigger: TriggerDefinition;
  gone: boolean;
  busy: boolean;
  mutationsAllowed: boolean;
  onCheck: () => void;
  onEdit: () => void;
  onRemove: (opener: HTMLButtonElement | null) => void;
}) {
  const menuButton = useRef<HTMLButtonElement>(null);
  return (
    <StudioRowMenu
      label={`${trigger.name} actions`}
      tooltip="Trigger actions"
      buttonRef={menuButton}
    >
      {!gone && (
        <>
          <DropdownMenuItem
            disabled={!trigger.enabled || busy || !mutationsAllowed}
            description={trigger.enabled ? undefined : "Turn the Trigger on to check it."}
            onSelect={onCheck}
          >
            <RefreshCw aria-hidden strokeWidth={1.5} />
            Check now
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil aria-hidden strokeWidth={1.5} />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem
        variant="destructive"
        aria-label="Remove"
        disabled={busy || !mutationsAllowed}
        onSelect={() => onRemove(menuButton.current)}
      >
        <Trash2 aria-hidden strokeWidth={1.5} />
        Remove…
      </DropdownMenuItem>
    </StudioRowMenu>
  );
}
