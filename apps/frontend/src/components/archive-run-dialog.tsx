import type { RunNavigationEntry } from "@t3-factory/contracts";
import { MutationGate } from "@/client-gate";
import { useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { api } from "../api.ts";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";

/**
 * Archive is final, so every entry point confirms it here. An archived Run leaves navigation, so
 * archiving the open Run returns to the composer.
 */
export function ArchiveRunDialog({
  run,
  entry,
  open,
  onOpenChange,
  onArchived,
  returnFocusId,
}: {
  run: { readonly id: string; readonly title: string };
  entry: RunNavigationEntry | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onArchived?: () => void;
  /** Receives focus when the dialog closes, if it is still on the page. */
  returnFocusId?: string | undefined;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const decisionNames = [
    ...new Set(
      entry?.attention.matters.flatMap((matter) =>
        matter.kind === "human" && matter.blockName ? [`“${matter.blockName}”`] : [],
      ),
    ),
  ];
  const findAgain =
    typeof entry?.number === "number" ? `#${entry.number} or its title` : "its title";
  const description = decisionNames.length
    ? `Archiving cancels the pending ${decisionNames.join(", ")} ${decisionNames.length === 1 ? "decision" : "decisions"}; find the Run again in the command palette by ${findAgain}.`
    : `Find this Run again in the command palette by ${findAgain}.`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function archive() {
    setBusy(true);
    setError("");
    return await api
      .archiveRun(run.id)
      .then(() => {
        onOpenChange(false);
        onArchived?.();
        if (pathname === `/runs/${run.id}`) void navigate({ to: "/runs/new" });
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not archive the Run.");
      })
      .finally(() => {
        setBusy(false);
      });
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          setError("");
          onOpenChange(next);
        }
      }}
    >
      <DialogContent
        title={<>Archive “{run.title}”?</>}
        description={description}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <MutationGate>
              <Button type="button" variant="danger" disabled={busy} onClick={() => void archive()}>
                {busy ? "Archiving…" : "Archive Run"}
              </Button>
            </MutationGate>
          </>
        }
        closeDisabled={busy}
        onCloseAutoFocus={(event) => {
          const target = returnFocusId && document.getElementById(returnFocusId);
          if (!target) return;
          event.preventDefault();
          target.focus();
        }}
      >
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
