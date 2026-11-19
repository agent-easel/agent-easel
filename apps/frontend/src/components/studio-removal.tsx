import type { ReactNode } from "react";
import type {
  FactoryProject,
  FlowDraft,
  TriggerDefinition,
  ValidationIssue,
} from "@t3-factory/contracts";
import { ChevronRight, Trash2, Workflow, Zap, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Surface } from "@/components/ui/surface";
import { studioOwner } from "../studio-definitions.ts";
import { StatusBadge } from "./status-badge.tsx";
import { cn } from "@/lib/utils";

/** The id and name an in-use refusal names, from `Trigger "Name" (id)` or `Flow "Name" (id)`. */
export function namedBlockers(issues: readonly ValidationIssue[], code: string) {
  return issues.flatMap((issue) => {
    if (issue.code !== code) return [];
    const match = /"([^"]+)" \(([^)]+)\)/.exec(issue.message);
    return match?.[1] && match[2] ? [{ name: match[1], id: match[2] }] : [];
  });
}

/** Can’t remove “name”: the definitions that still use it, each of which can be opened. */
export function CantRemoveDialog({
  open,
  name,
  label,
  children,
  onClose,
}: {
  open: boolean;
  name: string;
  /** Accessible name of the list, such as "Triggers". */
  label: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        title={<>Can’t remove “{name}”</>}
        actions={
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        }
        onKeyDownCapture={(event) => {
          if (event.key === "Escape") event.stopPropagation();
        }}
      >
        <p className="text-sm text-muted-foreground">Remove these {label} first.</p>
        <ul aria-label={label} className="grid gap-1.5">
          {children}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** Flows that still place an Agent. Each one opens, even when its Project is gone from T3. */
export function flowBlockers(
  flows: readonly FlowDraft[],
  projects: readonly FactoryProject[],
  open: (flowId: string) => void,
) {
  return flows.map((flow) => {
    const owner = studioOwner(flow.projectId, projects);
    return (
      <RemovalBlocker
        key={flow.id}
        icon={Workflow}
        name={flow.name}
        detail={owner.projectId === null ? "Global" : owner.title}
        gone={owner.gone}
        onOpen={() => open(flow.id)}
      />
    );
  });
}

/** Triggers that still start a Flow. A Trigger of a Project gone from T3 cannot be opened. */
export function triggerBlockers(
  triggers: readonly TriggerDefinition[],
  projects: readonly FactoryProject[],
  open: (triggerId: string) => void,
) {
  return triggers.map((trigger) => {
    const owner = studioOwner(trigger.projectId, projects);
    return (
      <RemovalBlocker
        key={trigger.id}
        icon={Zap}
        name={trigger.name}
        detail={owner.title}
        gone={owner.gone}
        onOpen={owner.gone ? undefined : () => open(trigger.id)}
      />
    );
  });
}

/** Blockers named by a refusal that the live list has not caught up with. They can still be opened. */
export function racedBlockers(
  blockers: readonly { id: string; name: string }[],
  detail: string,
  open: (id: string) => void,
) {
  return blockers.map((blocker) => (
    <RemovalBlocker
      key={blocker.id}
      icon={detail === "Trigger" ? Zap : Workflow}
      name={blocker.name}
      detail={detail}
      gone={false}
      onOpen={() => open(blocker.id)}
    />
  ));
}

/** The destructive Remove… item shared by the editor menus and named exactly “Remove”. */
export function RemoveMenuItem({
  disabled,
  description,
  onSelect,
}: {
  disabled?: boolean | undefined;
  description?: ReactNode | undefined;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      variant="destructive"
      aria-label="Remove"
      disabled={disabled}
      description={description}
      onSelect={onSelect}
    >
      <Trash2 aria-hidden />
      Remove…
    </DropdownMenuItem>
  );
}

const blockerRowClass = "flex w-full min-w-0 items-center gap-2 px-3 py-2.5";

/** One Flow or Trigger that blocks removal. A gone Trigger is text only; it cannot be opened. */
function RemovalBlocker({
  icon: Icon,
  name,
  detail,
  gone,
  onOpen,
}: {
  icon: LucideIcon;
  name: string;
  detail: string;
  gone: boolean;
  /** Absent when the definition cannot be opened, such as a Trigger of a Project gone from T3. */
  onOpen?: (() => void) | undefined;
}) {
  const body = (
    <>
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
      <span className="truncate text-sm leading-[normal] font-medium">{name}</span>
      <span className="shrink-0 text-2xs leading-[normal] text-subtle-foreground">{detail}</span>
      {gone && <StatusBadge kind="neutral">Not in T3</StatusBadge>}
      <span className="flex-1" />
    </>
  );
  return (
    <li>
      {onOpen ? (
        <Surface
          tone="inset"
          asChild
          className={cn(
            blockerRowClass,
            "text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
          )}
        >
          <button type="button" onClick={onOpen}>
            {body}
            <ChevronRight
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
              strokeWidth={1.5}
            />
          </button>
        </Surface>
      ) : (
        <Surface tone="inset" className={blockerRowClass}>
          {body}
        </Surface>
      )}
    </li>
  );
}
