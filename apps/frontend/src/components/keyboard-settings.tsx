import { useEffect, useId, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { KeyChip } from "@/components/ui/key-chip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  conflictingShortcut,
  fixedShortcutRows,
  formatShortcut,
  getDefaultShortcutBindings,
  sameShortcutBinding,
  shortcutDefinitions,
  shortcutGroupLabels,
  shortcutFromEvent,
  shortcutModifierError,
  validateShortcutBinding,
  type ShortcutBinding,
  type ShortcutId,
  type ShortcutProblem,
} from "../keyboard-shortcuts.ts";
import {
  resetShortcutBindings,
  saveShortcutBinding,
  setShortcutRecording,
  useShortcutPreferences,
} from "../shortcut-preferences.ts";
import { SettingsGroup, SettingsPage, SettingsProblemCard, SettingsRow } from "./settings-page.tsx";
import { StatusBadge } from "./status-badge.tsx";

type Command = (typeof shortcutDefinitions)[number];
const groups = [...new Set(shortcutDefinitions.map((command) => command.group))];

export function KeyboardSettings() {
  const { bindings, sessionOnly, storageIssue, isConflict } = useShortcutPreferences();
  const defaults = getDefaultShortcutBindings();
  const conflictCommands = shortcutDefinitions.filter(({ id }) => isConflict(id));
  const [editing, setEditing] = useState<Command>();
  const [error, setError] = useState<ShortcutProblem>();
  const customised = (id: ShortcutId) =>
    isConflict(id) || !sameShortcutBinding(bindings[id], defaults[id]);
  return (
    <SettingsPage
      title="Keyboard shortcuts"
      action={
        <Button
          variant="outline"
          disabled={!shortcutDefinitions.some(({ id }) => customised(id))}
          onClick={() => {
            resetShortcutBindings();
            setError(undefined);
          }}
        >
          Reset all
        </Button>
      }
    >
      {(sessionOnly || storageIssue) && (
        <SettingsProblemCard
          tone="warning"
          title={
            sessionOnly
              ? "Changes last only for this session"
              : "Couldn’t restore keyboard shortcuts"
          }
        >
          {storageIssue ?? "This browser can’t store shortcuts."}
        </SettingsProblemCard>
      )}
      {error && (
        <SettingsProblemCard tone="error" title={error.title}>
          {error.message}
        </SettingsProblemCard>
      )}
      {conflictCommands.length > 0 && (
        <div className="grid gap-5">
          {conflictCommands.map((command) => {
            const binding = defaults[command.id];
            const other = binding && conflictingShortcut(command.id, binding, bindings);
            return (
              <SettingsProblemCard
                id={`shortcut-conflict-${command.id}`}
                key={command.id}
                tone="error"
                title={`${command.label} has no shortcut`}
              >
                {other
                  ? `Its default, ${formatShortcut(binding)}, is now used by ${other.label}. Change ${other.label}, then reset ${command.label}.`
                  : `Reset ${command.label} to restore its default.`}
              </SettingsProblemCard>
            );
          })}
        </div>
      )}
      {groups.map((group) => (
        <SettingsGroup key={group} label={shortcutGroupLabels[group]}>
          {shortcutDefinitions
            .filter((command) => command.group === group)
            .map((command) => (
              <ShortcutRow
                key={command.id}
                command={command}
                binding={bindings[command.id]}
                conflict={isConflict(command.id)}
                onEdit={() => {
                  setError(undefined);
                  setEditing(command);
                }}
                onReset={
                  customised(command.id)
                    ? () => {
                        const problem = resetShortcutBindings(command.id);
                        setError(isConflict(command.id) ? undefined : problem);
                      }
                    : undefined
                }
              />
            ))}
        </SettingsGroup>
      ))}
      <SettingsGroup label="Fixed">
        {fixedShortcutRows().map(({ label, keys }) => (
          <SettingsRow
            key={label}
            title={label}
            control={keys.map((key) => (
              <KeyChip key={key}>{key}</KeyChip>
            ))}
          />
        ))}
      </SettingsGroup>
      {editing && <ShortcutRecorder command={editing} onClose={() => setEditing(undefined)} />}
    </SettingsPage>
  );
}

function ShortcutRow({
  command,
  binding,
  conflict,
  onEdit,
  onReset,
}: {
  command: Command;
  binding: ShortcutBinding | null;
  conflict: boolean;
  onEdit: () => void;
  onReset: (() => void) | undefined;
}) {
  const change = useRef<HTMLButtonElement>(null);
  return (
    <div
      role="group"
      aria-label={command.label}
      aria-invalid={conflict || undefined}
      aria-describedby={conflict ? `shortcut-conflict-${command.id}` : undefined}
    >
      <SettingsRow
        title={
          <span className="flex flex-wrap items-center gap-2">
            {command.label}
            {conflict && <StatusBadge kind="error">Conflict</StatusBadge>}
          </span>
        }
        control={
          <>
            <KeyChip>{formatShortcut(binding)}</KeyChip>
            {onReset && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="-my-0.5 size-8 p-0.5"
                    aria-label={`Reset ${command.label}`}
                    onClick={() => {
                      change.current?.focus();
                      onReset();
                    }}
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-md border">
                      <RotateCcw aria-hidden className="size-3.5" />
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reset</TooltipContent>
              </Tooltip>
            )}
            <Button
              ref={change}
              variant="outline"
              size="sm"
              aria-label={`Change ${command.label}`}
              onClick={onEdit}
            >
              Change
            </Button>
          </>
        }
      />
    </div>
  );
}

function useShortcutCapture(id: ShortcutId) {
  const { bindings } = useShortcutPreferences();
  const [candidate, setCandidate] = useState<ShortcutBinding>();
  const [modifierError, setModifierError] = useState<ShortcutProblem>();
  const [saveError, setSaveError] = useState<ShortcutProblem>();
  const validation = candidate ? validateShortcutBinding(id, candidate, bindings) : modifierError;
  const problem = validation ?? saveError;
  useEffect(() => {
    setShortcutRecording(true);
    const record = (event: KeyboardEvent) => {
      if (!shouldRecord(event)) return;
      event.stopPropagation();
      const next = shortcutFromEvent(event);
      const modifier = shortcutModifierError(event);
      if (!next && !modifier) return;
      event.preventDefault();
      setCandidate(next);
      setModifierError(modifier);
      setSaveError(undefined);
    };
    window.addEventListener("keydown", record, true);
    return () => {
      window.removeEventListener("keydown", record, true);
      setShortcutRecording(false);
    };
  }, []);
  const canSave = Boolean(candidate && !validation);
  const save = () => {
    if (!candidate) return false;
    const result = saveShortcutBinding(id, candidate);
    if (result) setSaveError(result);
    return !result;
  };
  return { candidate, problem, canSave, save };
}

function ShortcutRecorder({ command, onClose }: { command: Command; onClose: () => void }) {
  const { candidate, problem, canSave, save } = useShortcutCapture(command.id);
  const capture = useRef<HTMLDivElement>(null);
  const issueId = useId();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={`Change “${command.label}”`}
        actions={
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant={canSave ? "default" : "outline"}
              disabled={!canSave}
              onClick={() => {
                if (save()) onClose();
              }}
            >
              Save
            </Button>
          </>
        }
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          capture.current?.focus();
        }}
      >
        <div
          ref={capture}
          role="textbox"
          tabIndex={0}
          aria-label="Shortcut"
          aria-readonly
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? issueId : undefined}
          className={cn(
            "flex min-h-16 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground outline-none",
            problem ? "border-destructive" : "border-ring ring-1 ring-ring/30",
          )}
        >
          <span aria-live="polite">
            {candidate ? <KeyChip>{formatShortcut(candidate)}</KeyChip> : "Press a shortcut"}
          </span>
          {problem && <StatusBadge kind="error">{problem.tag}</StatusBadge>}
        </div>
        {problem && (
          <SettingsProblemCard id={issueId} tone="error" title={problem.title}>
            {problem.message}
          </SettingsProblemCard>
        )}
      </DialogContent>
    </Dialog>
  );
}

function shouldRecord(event: KeyboardEvent) {
  if (event.repeat || event.isComposing || event.keyCode === 229) return false;
  if (event.key === "Tab" || event.key === "Escape") return false;
  const fromButton = event.target instanceof HTMLElement && event.target.closest("button");
  const modified = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
  return !(fromButton && !modified && ["Enter", " "].includes(event.key));
}
