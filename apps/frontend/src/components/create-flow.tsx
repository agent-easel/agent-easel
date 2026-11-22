import { MutationGate, useMutationsAllowed, useOfflineReason } from "@/client-gate";
import { useState, type FormEvent } from "react";
import type { FlowDraft } from "@t3-factory/contracts";
import { validateCreateFlow } from "@t3-factory/domain-validation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  defaultOwner,
  ownerPicker,
  useStudioOwners,
  type StudioDefinitions,
} from "../studio-definitions.ts";
import { fieldLabelClass } from "./page.tsx";
import { OwnerPicker } from "./studio-owner.tsx";
import { ProblemCard } from "./problem-card.tsx";

export function CreateFlow({
  definitions,
  onClose,
  onCreated,
}: {
  definitions: StudioDefinitions;
  onClose: () => void;
  onCreated: (flow: FlowDraft) => void;
}) {
  const { projects, filter } = useStudioOwners(definitions);
  // The owner filter preselects the owner once, when the dialog opens.
  const [initialOwner] = useState(() => defaultOwner(filter));
  const [name, setName] = useState("");
  const [owner, setOwner] = useState(initialOwner);
  const blocked = ownerPicker(owner, projects).blocked;
  const blank = name.trim() === "";
  const [reason, setReason] = useState("");
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const allowed = useMutationsAllowed();
  const offline = useOfflineReason();
  const beside = flowCreateBeside(blank, blocked, reason || (saving ? "" : offline));
  return (
    <NewFlowDialog
      name={name}
      owner={owner}
      projects={projects}
      initialOwner={initialOwner}
      saving={saving}
      failed={failed}
      beside={beside}
      filled={allowed && (saving || (!blank && !blocked))}
      onName={setName}
      onOwner={setOwner}
      onClose={onClose}
      onSubmit={(event) =>
        void submitNewFlow(event, {
          saving,
          blank,
          blocked,
          name,
          owner,
          create: definitions.createFlow,
          onCreated,
          setFailed,
          setReason,
          setSaving,
        })
      }
    />
  );
}

function flowCreateBeside(blank: boolean, blocked: string | null, reason: string) {
  if (blank) return "";
  return blocked || reason;
}

async function submitNewFlow(
  event: FormEvent,
  input: {
    saving: boolean;
    blank: boolean;
    blocked: string | null;
    name: string;
    owner: string | null;
    create: StudioDefinitions["createFlow"];
    onCreated: (flow: FlowDraft) => void;
    setFailed: (failed: boolean) => void;
    setReason: (reason: string) => void;
    setSaving: (saving: boolean) => void;
  },
) {
  event.preventDefault();
  if (input.saving || input.blank || input.blocked) return;
  const validation = validateCreateFlow({ name: input.name, projectId: input.owner });
  input.setFailed(false);
  if (!validation.ok) {
    input.setReason(validation.error.message);
    return;
  }
  input.setSaving(true);
  input.setReason("");
  try {
    input.onCreated(await input.create(validation.value));
  } catch {
    input.setFailed(true);
    input.setSaving(false);
  }
}

function NewFlowDialog({
  name,
  owner,
  projects,
  initialOwner,
  saving,
  failed,
  beside,
  filled,
  onName,
  onOwner,
  onClose,
  onSubmit,
}: {
  name: string;
  owner: string | null;
  projects: ReturnType<typeof useStudioOwners>["projects"];
  initialOwner: string | null;
  saving: boolean;
  failed: boolean;
  beside: string;
  filled: boolean;
  onName: (name: string) => void;
  onOwner: (owner: string | null) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const leave = (event: { preventDefault: () => void }) => {
    if (saving) event.preventDefault();
  };
  const escape = (event: Pick<KeyboardEvent, "key" | "preventDefault" | "stopPropagation">) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (!saving) onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        title="New Flow"
        actions={
          <>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <div className="flex min-w-0 items-center gap-2">
              {beside && <p className="text-sm text-destructive">{beside}</p>}
              <MutationGate>
                <Button
                  type="submit"
                  variant={filled ? "default" : "outline"}
                  disabled={saving || !filled}
                >
                  {saving ? "Saving…" : "Create Flow"}
                </Button>
              </MutationGate>
            </div>
          </>
        }
        onSubmit={onSubmit}
        closeDisabled={saving}
        onKeyDownCapture={escape}
        onEscapeKeyDown={escape}
        onPointerDownOutside={leave}
        onInteractOutside={leave}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="flow-name" className={fieldLabelClass}>
            Flow name
          </Label>
          <Input
            id="flow-name"
            autoFocus
            maxLength={200}
            value={name}
            onChange={(event) => onName(event.target.value)}
            placeholder="e.g. Change and review"
            disabled={saving}
          />
        </div>
        <div>
          <OwnerPicker
            kind="Flow"
            chosen={owner}
            projects={projects}
            onChange={onOwner}
            disabled={saving}
            initial={initialOwner}
            hint=""
            quietStatus
          />
        </div>
        {failed && (
          <ProblemCard density="compact" tone="error" title="Couldn’t create the Flow">
            Your name and owner are kept — try again.
          </ProblemCard>
        )}
      </DialogContent>
    </Dialog>
  );
}
