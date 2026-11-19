import { useState, type ComponentProps } from "react";
import { ChevronDown } from "lucide-react";
import type {
  AgentCapabilities,
  AgentProjectOverride,
  FactoryProject,
} from "@t3-factory/contracts";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { workerTrigger } from "@/lib/agent-display";
import { cn } from "@/lib/utils";
import { ExecutionSettingsFields } from "../execution-settings-fields.tsx";
import { useMenuActions } from "../menu-actions.ts";
import {
  OverrideDialog,
  ProjectOverridesSection,
  type OverrideEditing,
} from "./agent-project-overrides.tsx";

type WorkerSettings = ComponentProps<typeof ExecutionSettingsFields>["settings"] & {
  readonly needsModel: boolean;
};

/**
 * Figma SA06/SA06e/SA06h: the header button naming what the Agent runs on, “Provider · Model ·
 * Effort”. It opens the Worker settings and, for a global Agent, its Project overrides; every
 * change is a draft edit.
 */
export function AgentModelPicker({
  settings,
  capabilities,
  saving,
  disabled,
  attention,
  describedBy,
  overrides,
}: {
  settings: WorkerSettings;
  capabilities: AgentCapabilities | null;
  saving: boolean;
  /** The editor is read-only, such as while its Project is not in T3. */
  disabled: boolean;
  /** A card under the header explains a problem with the chosen Worker, such as reporting. */
  attention: boolean;
  /** The card explaining the trigger's attention state. */
  describedBy: string | undefined;
  /** A global Agent's Project overrides; absent for a Project Agent, which has none. */
  overrides?:
    | {
        readonly list: readonly AgentProjectOverride[];
        readonly projects: readonly FactoryProject[];
        readonly onSet: (override: AgentProjectOverride) => void;
        readonly onRemove: (projectId: string) => void;
      }
    | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OverrideEditing | null>(null);
  // The Override dialog opens once the popover has closed and refocused the picker, so the dialog
  // returns focus to the picker when it closes.
  const { trigger, queue, onCloseAutoFocus } = useMenuActions();
  const shown = workerTrigger(settings.execution, capabilities);
  const needsModel = shown.state === "needs-model";
  const flagged = needsModel || attention;
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={`Worker: ${shown.label}`}
            aria-invalid={flagged || undefined}
            aria-describedby={flagged ? describedBy : undefined}
            className={cn(
              "h-8 min-w-0 shrink gap-1.5 bg-card pr-2 pl-2.5 font-medium data-[state=open]:border-primary",
              flagged && "border-attention data-[state=open]:border-attention",
            )}
          >
            <span className={cn("min-w-0 truncate", needsModel && "text-attention")}>
              {shown.label}
            </span>
            <ChevronDown
              aria-hidden
              strokeWidth={1.5}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          collisionPadding={16}
          aria-labelledby="worker-heading"
          className="flex max-h-(--radix-popover-content-available-height) w-110 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-[10px] border-border bg-card p-3.5"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <h2 id="worker-heading" className="text-sm font-semibold">
            Worker
          </h2>
          <ExecutionSettingsFields role="worker" settings={settings} saving={saving} />
          {overrides && (
            <ProjectOverridesSection
              overrides={overrides.list}
              projects={overrides.projects}
              capabilities={capabilities}
              needsModel={settings.needsModel}
              disabled={saving}
              onEdit={(edit) => {
                queue(() => setEditing(edit));
                setOpen(false);
              }}
              onRemove={overrides.onRemove}
            />
          )}
        </PopoverContent>
      </Popover>
      {overrides && editing && (
        <OverrideDialog
          key={editing.projectId ?? "new"}
          editing={editing}
          overrides={overrides.list}
          execution={settings.execution}
          projects={overrides.projects}
          capabilities={capabilities}
          onClose={() => setEditing(null)}
          onApply={(override) => {
            overrides.onSet(override);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
