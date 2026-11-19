import { otherRepositoryWatchers } from "./trigger-notices.tsx";
import { StartedRuns } from "./started-runs.tsx";
import { useRef, useState } from "react";
import { ChevronRight, Pencil, RefreshCw, Trash2, Zap } from "lucide-react";
import type { FactoryProject, TriggerDefinition, TriggerStartedRun } from "@t3-factory/contracts";
import { MutationGate, useMutationsAllowed } from "@/client-gate";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "../status-badge.tsx";
import { RemoveTriggerDialog } from "./remove-trigger-dialog.tsx";
import type { TriggerActions } from "./trigger-actions.ts";
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

/** Turning a Trigger on first shows what its first check would start. */
const enableReview = (
  trigger: TriggerDefinition,
  names: TriggerNames,
  actions: TriggerActions,
  changed: boolean,
  triggers: readonly TriggerDefinition[] | null,
): TriggerReview => ({
  title: `Enable “${trigger.name}”?`,
  summary: reviewSummary(trigger, trigger.github.repository.nameWithOwner, names),
  repository: trigger.github.repository.nameWithOwner,
  watchers: otherRepositoryWatchers(triggers, trigger.github.repository, trigger.id),
  confirmLabel: "Enable and check",
  load: () => actions.preview(trigger),
  ...(changed && {
    notice: `Revision ${trigger.revision} was saved after your review, so nothing was enabled. Review these settings before enabling.`,
  }),
});

/**
 * The review before enabling a saved Trigger; Enable and check confirms the revision it showed.
 * When another revision was saved after that, the review opens again on the current settings.
 */
export function useEnableReview(
  names: TriggerNames,
  actions: TriggerActions,
  triggers: readonly TriggerDefinition[] | null,
) {
  const [reviewing, setReviewing] = useState<{
    readonly trigger: TriggerDefinition;
    readonly review: TriggerReview;
  } | null>(null);
  const busy = reviewing !== null && actions.state.pending.get(reviewing.trigger.id) === "enable";
  /** Opens the review of `trigger`; `changed` says another revision replaced the reviewed one. */
  const open = (trigger: TriggerDefinition, changed = false) =>
    setReviewing({ trigger, review: enableReview(trigger, names, actions, changed, triggers) });
  /** Enable and check `trigger` at the reviewed `revision`, or review it again if it changed. */
  const enable = (trigger: TriggerDefinition, revision: number) =>
    actions
      .enableAndCheck(trigger, revision)
      .then((latest) => (latest ? open(latest, true) : setReviewing(null)));
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
          // A preview that did not show a saved revision cannot confirm one: review again.
          if (preview.revision === null) return open(reviewing.trigger, true);
          void enable(reviewing.trigger, preview.revision);
        }}
      />
    ),
  };
}

/** The Runs a Check now started in this visit. An empty list is “Nothing ready to start”. */
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
  /** Opens the review before enabling `trigger`. */
  onEnable: (trigger: TriggerDefinition) => void;
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
  const checked = (trigger: TriggerDefinition) =>
    void actions.run(trigger).then((reply) => rememberCheck(setStarted, trigger.id, reply));
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
      {failure && (
        <Alert variant="destructive">
          <AlertDescription>
            {failure.name}: {failure.message}
          </AlertDescription>
        </Alert>
      )}
      <StudioListBody
        error={Boolean(triggers.error)}
        loaded={loaded}
        noMatch={noMatch}
        empty={groups.length === 0}
        errorText="Couldn’t load Triggers."
        loadingText="Loading Triggers…"
        noMatchText="No matching Triggers"
        emptyIcon={<Zap aria-hidden className="size-8" strokeWidth={1.5} />}
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
                  onEnable={() => onEnable(trigger)}
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
  reply:
    | {
        readonly error: TriggerDefinition["error"];
        readonly startedRuns: readonly TriggerStartedRun[];
      }
    | undefined,
) {
  if (!reply) return;
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
      meta={<TriggerMeta trigger={trigger} names={names} checking={checking} started={started} />}
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

function TriggerMeta({
  trigger,
  names,
  checking,
  started,
}: {
  trigger: TriggerDefinition;
  names: TriggerNames;
  checking: boolean;
  started: readonly TriggerStartedRun[] | undefined;
}) {
  if (checking) return "Checking…";
  if (started) {
    if (started.length === 0) return "Nothing ready to start";
    return <StartedRuns runs={started} />;
  }
  return `GitHub Issues · ${triggerRoute(trigger, names)} · ${scheduleText(trigger.schedule)}`;
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
