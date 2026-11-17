import { useRef, useState } from "react";
import { Ellipsis, Pencil, Play, Trash2, Zap } from "lucide-react";
import type { TriggerDefinition } from "@t3-factory/contracts";
import { MutationGate, useMutationsAllowed } from "@/client-gate";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StudioLink } from "../app-link.tsx";
import { SettingsGroup, SettingsPage } from "../settings-page.tsx";
import { useStudioNavigation } from "../../settings-navigation.ts";
import type { StudioRead } from "../../studio-definitions.ts";
import { RemoveTriggerDialog } from "./remove-trigger-dialog.tsx";
import { TriggerHealth } from "./trigger-health.tsx";
import type { TriggerActions } from "./trigger-actions.ts";
import { TriggerReviewDialog, type TriggerReview } from "./trigger-review-dialog.tsx";
import {
  problemHeadline,
  reviewSummary,
  scheduleText,
  triggerRoute,
  type TriggerNames,
} from "./trigger-text.ts";

/** Turning a Trigger on first shows what its first check would start. */
const enableReview = (
  trigger: TriggerDefinition,
  names: TriggerNames,
  actions: TriggerActions,
): TriggerReview => ({
  title: `Enable “${trigger.name}”?`,
  summary: reviewSummary(trigger, trigger.github.repository.nameWithOwner, names),
  query: trigger.github.query,
  readyLabel: trigger.github.readyLabel,
  confirmLabel: "Enable and check",
  load: () => actions.preview(trigger),
});

/** The review a Trigger's switch opens; Enable and check commits it. */
function useEnableReview(names: TriggerNames, actions: TriggerActions) {
  const [reviewing, setReviewing] = useState<{
    readonly trigger: TriggerDefinition;
    readonly review: TriggerReview;
  } | null>(null);
  const busy = reviewing !== null && actions.state.pending.get(reviewing.trigger.id) === "enable";
  return {
    open: (trigger: TriggerDefinition) =>
      setReviewing({ trigger, review: enableReview(trigger, names, actions) }),
    dialog: (
      <TriggerReviewDialog
        review={reviewing?.review ?? null}
        busy={busy}
        onCancel={() => setReviewing(null)}
        onConfirm={() => {
          if (!reviewing) return;
          void actions.enableAndCheck(reviewing.trigger).then(() => setReviewing(null));
        }}
      />
    ),
  };
}

const description =
  "Start a Flow automatically for issues a person marks ready in a Project's tracker.";

/** Figma T01/T02: the Triggers list, or the empty state that explains Triggers. */
export function TriggersList({
  triggers,
  names,
  actions,
}: {
  triggers: StudioRead<readonly TriggerDefinition[]>;
  names: TriggerNames;
  actions: TriggerActions;
}) {
  const openStudio = useStudioNavigation();
  const create = () => void openStudio({ tab: "triggers", triggerId: "new" });
  const items = triggers.value;
  const [removing, setRemoving] = useState<TriggerDefinition | null>(null);
  const enabling = useEnableReview(names, actions);
  const menuButton = useRef<HTMLElement | null>(null);
  const { failure, pending } = actions.state;
  return (
    <main className="grid content-start px-8 pt-6 pb-8 max-sm:px-4">
      <SettingsPage
        title="Triggers"
        description={description}
        action={
          items?.length ? (
            <MutationGate>
              <Button onClick={create}>New Trigger</Button>
            </MutationGate>
          ) : undefined
        }
      >
        {failure && (
          <Alert variant="destructive">
            <AlertDescription>
              {failure.name}: {failure.message}
            </AlertDescription>
          </Alert>
        )}
        <TriggerItems
          triggers={triggers}
          names={names}
          actions={actions}
          onCreate={create}
          onEnable={enabling.open}
          onRemove={(trigger, opener) => {
            menuButton.current = opener;
            setRemoving(trigger);
          }}
        />
      </SettingsPage>
      {enabling.dialog}
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

/** The loaded Triggers as rows, the empty state, or why they cannot be shown. */
function TriggerItems({
  triggers,
  names,
  actions,
  onCreate,
  onEnable,
  onRemove,
}: {
  triggers: StudioRead<readonly TriggerDefinition[]>;
  names: TriggerNames;
  actions: TriggerActions;
  onCreate: () => void;
  onEnable: (trigger: TriggerDefinition) => void;
  onRemove: (trigger: TriggerDefinition, opener: HTMLElement | null) => void;
}) {
  const items = triggers.value;
  return triggers.error ? (
    <Alert variant="destructive">
      <AlertDescription>Could not load Triggers. Check that Factory is running.</AlertDescription>
    </Alert>
  ) : items === null ? (
    <p role="status" className="text-sm text-muted-foreground">
      Loading Triggers…
    </p>
  ) : (
    <SettingsGroup label={items.length ? `Triggers · ${items.length}` : "Triggers"}>
      {items.length === 0 ? (
        <EmptyTriggers onCreate={onCreate} />
      ) : (
        items.map((trigger) => (
          <TriggerRow
            key={trigger.id}
            trigger={trigger}
            names={names}
            busy={actions.state.pending.has(trigger.id)}
            actions={actions}
            onEnable={() => onEnable(trigger)}
            onRemove={(opener) => onRemove(trigger, opener)}
          />
        ))
      )}
    </SettingsGroup>
  );
}

function EmptyTriggers({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="flex flex-col items-center px-6 pt-10 pb-10 text-center">
      <span className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Zap aria-hidden className="size-4" strokeWidth={1.5} />
      </span>
      <h2 className="mt-3 text-sm font-semibold text-foreground">No Triggers yet</h2>
      <p className="mt-3 max-w-108 text-sm leading-tight text-muted-foreground">
        A Trigger checks one Project&apos;s GitHub repository for open issues labelled factory:ready
        and starts a Flow for each one, on a schedule or when you choose Run.
      </p>
      <MutationGate>
        <Button className="mt-3" onClick={onCreate}>
          New Trigger
        </Button>
      </MutationGate>
      <p className="mt-4 max-w-108 text-2xs leading-tight tracking-label text-subtle-foreground">
        Tip: run setup-factory in the repository first. It creates the factory:ready label and tells
        workers how to claim a ready issue.
      </p>
    </section>
  );
}

function TriggerRow({
  trigger,
  names,
  busy,
  actions,
  onEnable,
  onRemove,
}: {
  trigger: TriggerDefinition;
  names: TriggerNames;
  busy: boolean;
  actions: TriggerActions;
  onEnable: () => void;
  onRemove: (opener: HTMLElement | null) => void;
}) {
  const openStudio = useStudioNavigation();
  const mutationsAllowed = useMutationsAllowed();
  const menuButton = useRef<HTMLButtonElement>(null);
  const edit = { tab: "triggers", triggerId: trigger.id } as const;
  return (
    <div className="relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50">
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <Zap aria-hidden className="size-4" strokeWidth={1.5} />
      </span>
      <div className="grid min-w-0 flex-1 gap-0.75">
        <div className="flex min-w-0 items-center gap-2">
          {/* The name's link covers the row, so clicking anywhere but the controls opens Edit. */}
          <StudioLink
            selection={edit}
            className="truncate text-sm leading-tight font-medium text-foreground after:absolute after:inset-0 hover:no-underline"
          >
            {trigger.name}
          </StudioLink>
          <TriggerHealth trigger={trigger} />
        </div>
        <p className="truncate text-sm leading-tight text-subtle-foreground">
          GitHub Issues · {triggerRoute(trigger, names)} · {scheduleText(trigger.schedule)}
        </p>
        {trigger.error && (
          <p className="truncate text-2xs leading-tight tracking-label text-destructive">
            {problemHeadline(trigger.error)}: {trigger.error.message}
          </p>
        )}
      </div>
      <MutationGate>
        <Switch
          className="relative"
          aria-label={trigger.name}
          checked={trigger.enabled}
          disabled={busy}
          onCheckedChange={(enabled) => (enabled ? onEnable() : void actions.disable(trigger))}
        />
      </MutationGate>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                ref={menuButton}
                variant="ghost"
                size="icon-sm"
                className="relative size-7 text-muted-foreground"
                aria-label={`${trigger.name} actions`}
              >
                <Ellipsis aria-hidden className="size-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Trigger actions</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuItem
            disabled={!trigger.enabled || busy || !mutationsAllowed}
            title={trigger.enabled ? undefined : "Turn the Trigger on to run it."}
            onSelect={() => void actions.run(trigger)}
          >
            <Play aria-hidden strokeWidth={1.5} />
            Run
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void openStudio(edit)}>
            <Pencil aria-hidden strokeWidth={1.5} />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={busy || !mutationsAllowed}
            onSelect={() => onRemove(menuButton.current)}
          >
            <Trash2 aria-hidden strokeWidth={1.5} />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
