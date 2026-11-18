import { MutationGate } from "@/client-gate";
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
import { OwnerPicker, ownerHint } from "./studio-owner.tsx";

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
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  function handleEscape(event: Pick<KeyboardEvent, "key" | "preventDefault" | "stopPropagation">) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (!saving) onClose();
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || blocked) return;
    const validation = validateCreateFlow({ name, projectId: owner });
    if (!validation.ok) {
      setError(validation.error.message);
      return;
    }
    setSaving(true);
    setError("");
    try {
      onCreated(await definitions.createFlow(validation.value));
    } catch {
      setError("Could not save the draft. Your name is still here; try again.");
      setSaving(false);
    }
  }
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
            <MutationGate>
              <Button type="submit" disabled={saving || Boolean(blocked)}>
                {saving ? "Saving…" : "Create Flow"}
              </Button>
            </MutationGate>
          </>
        }
        onSubmit={(event) => void submit(event)}
        closeDisabled={saving}
        // Guard Escape while the parent Studio modal is also mounted.
        onKeyDownCapture={handleEscape}
        onEscapeKeyDown={handleEscape}
        onPointerDownOutside={(event) => {
          if (saving) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (saving) event.preventDefault();
        }}
      >
        <div className="grid gap-1.5 pt-4">
          <Label htmlFor="flow-name">Flow name</Label>
          <Input
            id="flow-name"
            autoFocus
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Change and review"
            aria-describedby={error ? "name-error" : undefined}
            disabled={saving}
          />
          {error && (
            <p className="text-sm text-destructive" id="name-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="pt-4 pb-4">
          <OwnerPicker
            kind="Flow"
            chosen={owner}
            projects={projects}
            onChange={setOwner}
            disabled={saving}
            initial={initialOwner}
            hint={ownerHint(filter, projects, "Flows")}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
