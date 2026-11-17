import { useRef, useState, type ComponentProps } from "react";
import { ChevronDown } from "lucide-react";
import type {
  AgentCapabilities,
  AgentProjectOverride,
  FactoryProject,
} from "@t3-factory/contracts";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { workerTrigger, type WorkerTrigger } from "@/lib/agent-display";
import { cn } from "@/lib/utils";
import { ExecutionSettingsFields } from "../execution-settings-fields.tsx";
import {
  OverrideDialog,
  ProjectOverridesSection,
  type OverrideEditing,
} from "./agent-project-overrides.tsx";

type WorkerSettings = ComponentProps<typeof ExecutionSettingsFields>["settings"];

/**
 * Figma SA01/SA01b/SA01c: the header button naming what the Agent runs on. It opens the Worker
 * settings and, for a global Agent, its Project overrides; every change is a draft edit.
 */
export function AgentModelPicker({
  settings,
  capabilities,
  saving,
  overrides,
}: {
  settings: WorkerSettings;
  capabilities: AgentCapabilities | null;
  saving: boolean;
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
  const trigger = useRef<HTMLButtonElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  // The Override dialog opens once the popover has closed and refocused the picker, so the dialog
  // returns focus to the picker when it closes.
  const pendingEdit = useRef<OverrideEditing | null>(null);
  const shown = workerTrigger(settings.execution, capabilities);
  const button = (
    <PopoverTrigger asChild>
      <Button
        ref={trigger}
        type="button"
        variant="secondary"
        aria-label={`Worker: ${shown.label}`}
        className="min-w-0 shrink gap-1.5 px-2 data-[state=open]:border-primary"
      >
        <TriggerFace trigger={shown} />
        <ChevronDown aria-hidden strokeWidth={1.5} className="size-3.5 text-muted-foreground" />
      </Button>
    </PopoverTrigger>
  );
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        {shown.reason ? (
          <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent>{shown.reason}</TooltipContent>
          </Tooltip>
        ) : (
          button
        )}
        <PopoverContent
          align="end"
          collisionPadding={16}
          aria-labelledby="worker-execution-heading"
          className="@container/agent-form flex max-h-(--radix-popover-content-available-height) w-115 max-w-[calc(100vw-2rem)] flex-col gap-2.5 overflow-y-auto rounded-[10px] border-border bg-card p-3.5"
          onCloseAutoFocus={(event) => {
            const edit = pendingEdit.current;
            if (!edit) return;
            pendingEdit.current = null;
            event.preventDefault();
            trigger.current?.focus();
            setEditing(edit);
          }}
        >
          <ExecutionSettingsFields
            role="worker"
            capabilities={capabilities}
            settings={settings}
            saving={saving}
          />
          {overrides && (
            <>
              <Separator />
              <ProjectOverridesSection
                overrides={overrides.list}
                projects={overrides.projects}
                capabilities={capabilities}
                needsModel={settings.needsModel}
                disabled={saving}
                addRef={add}
                onEdit={(edit) => {
                  pendingEdit.current = edit;
                  setOpen(false);
                }}
                onRemove={(projectId) => {
                  overrides.onRemove(projectId);
                  add.current?.focus();
                }}
              />
              <p className="text-label text-subtle-foreground">
                Other Projects use the Global worker. Name, prompt and exits stay shared.
              </p>
            </>
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

/** The provider glyph, model and effort; Needs a model, Unavailable and Unknown say so. */
function TriggerFace({ trigger }: { trigger: WorkerTrigger }) {
  if (trigger.state === "needs-model")
    return <span className="font-medium text-attention">{trigger.label}</span>;
  return (
    <>
      <span
        aria-hidden
        className="flex size-3.5 shrink-0 items-center justify-center rounded-sm bg-accent text-[0.5625rem] font-semibold text-muted-foreground"
      >
        {trigger.glyph}
      </span>
      <span className="min-w-0 truncate font-medium">{trigger.model}</span>
      {trigger.effort && (
        <span className="shrink-0 font-normal text-subtle-foreground">· {trigger.effort}</span>
      )}
      {trigger.state !== "ok" && (
        <span
          className={cn(
            "shrink-0 font-medium",
            trigger.state === "unavailable" ? "text-attention" : "text-muted-foreground",
          )}
        >
          · {trigger.state === "unavailable" ? "Unavailable" : "Unknown"}
        </span>
      )}
    </>
  );
}
