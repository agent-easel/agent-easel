import { useRef, useState } from "react";
import type { RunSettlementOutcome, RunSettlementWorker } from "@t3-factory/contracts";
import { api } from "../api.ts";
import { MutationGate } from "../client-gate.tsx";
import { Button } from "./ui/button";
import { AlertDialog, AlertDialogCancel, AlertDialogContent } from "./ui/alert-dialog";

/** Figma RD53: one sentence on what happens to the workers T3 still runs. */
function settleDescription(workers: readonly RunSettlementWorker[]) {
  const working = workers.filter((worker) => worker.state !== "finished").length;
  return working === 1
    ? "Factory asks T3 to stop the working Agent and ends the Run once T3 confirms it stopped."
    : `Factory asks T3 to stop the ${working} working Agents and ends the Run once T3 confirms they stopped.`;
}

/** Every Settle entry point waits for explicit authorization before stopping workers. */
export function useSettleRun() {
  const [confirmation, setConfirmation] =
    useState<Extract<RunSettlementOutcome, { outcome: "confirmation-required" }>>();
  // The last confirmation shown keeps the dialog's text while it closes.
  const [shown, setShown] = useState(confirmation);
  const answer = useRef<(outcome: RunSettlementOutcome | undefined) => void>(() => undefined);
  const requesting = useRef<(running: boolean) => void>(() => undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);
  function close(outcome?: RunSettlementOutcome) {
    setConfirmation(undefined);
    setError("");
    answer.current(outcome);
    answer.current = () => undefined;
    requesting.current = () => undefined;
  }
  /** `onRequesting` hears that the confirmation waits for the user, and when each confirmed
   * request starts and ends, so the caller's busy state covers that request too. */
  async function settle(
    id: string,
    retry: boolean,
    onRequesting: (running: boolean) => void = () => undefined,
  ) {
    if (busy) return;
    close();
    let outcome = await api.settleRun(id, retry ? { stopWorkers: true } : {});
    // Navigation can lag behind a failed Stop whose settlement was already confirmed.
    if (!retry && outcome.outcome === "unresolved")
      outcome = await api.settleRun(id, { stopWorkers: true });
    if (outcome.outcome !== "confirmation-required") return outcome;
    const opener = document.activeElement;
    // The row menu may still be closing when the answer arrives; it unmounts before the dialog
    // returns focus, so its content or items cannot be the return target.
    returnFocus.current =
      opener instanceof HTMLElement && opener !== document.body && !opener.closest('[role="menu"]')
        ? opener
        : document.getElementById(`run-row-${id}`);
    setConfirmation(outcome);
    setShown(outcome);
    requesting.current = onRequesting;
    onRequesting(false);
    return new Promise<RunSettlementOutcome | undefined>((resolve) => {
      answer.current = resolve;
    });
  }
  async function confirm() {
    if (!confirmation || busy) return;
    setBusy(true);
    setError("");
    requesting.current(true);
    return await api
      .settleRun(confirmation.run.id, { stopWorkers: true })
      .then((outcome) => {
        close(outcome);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not settle the Run.");
      })
      .finally(() => {
        setBusy(false);
        // A refused request leaves the confirmation open for another answer.
        requesting.current(false);
      });
  }
  return {
    settle,
    dialog: (
      <AlertDialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open && !busy) close();
        }}
      >
        <AlertDialogContent
          title={<>Settle “{shown?.run.title}”?</>}
          description={shown ? settleDescription(shown.workers) : ""}
          actions={
            <>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <MutationGate>
                <Button disabled={busy} onClick={() => void confirm()}>
                  {busy ? "Settling…" : "Settle Run"}
                </Button>
              </MutationGate>
            </>
          }
          closeDisabled={busy}
          onCloseAutoFocus={(event) => {
            if (!returnFocus.current?.isConnected) return;
            event.preventDefault();
            returnFocus.current.focus();
          }}
        >
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </AlertDialogContent>
      </AlertDialog>
    ),
  };
}
