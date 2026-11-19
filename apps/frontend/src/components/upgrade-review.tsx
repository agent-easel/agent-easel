import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { api } from "../api.ts";
import { upgradeScope, type UpgradeFailure, type UpgradeTarget } from "../use-upgrade.ts";

function targetTitle(target: UpgradeTarget) {
  if (target.kind === "client") return "Client · This device";
  return target.local || !target.host ? "Server · This device" : `Server · ${target.host}`;
}

/** Open Runs on the server being replaced; they wait and reconcile, they are never stopped. */
function useOpenRunCount(server: UpgradeTarget | undefined) {
  const [count, setCount] = useState<number | null>(null);
  const local = server ? server.local : null;
  useEffect(() => {
    if (local === null) return;
    let active = true;
    void (local ? api.getHostLifecycle() : api.getServerUpdate())
      .then((value) => active && setCount(value.openRunCount))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [local]);
  return count;
}

/** Every downloaded target with its current and target release, before anything changes. */
export function UpgradeReview({
  targets,
  onCancel,
  onConfirm,
}: {
  targets: readonly UpgradeTarget[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ready = targets.filter((target) => target.update.state === "downloaded");
  const server = ready.find((target) => target.kind === "server");
  const openRuns = useOpenRunCount(server);
  const version = ready[0]?.update.version ?? "the downloaded version";
  const title = ready.length > 1 ? `Upgrade ${upgradeScope(targets)}?` : `Upgrade to ${version}?`;
  const description =
    ready.length > 1
      ? "The server updates before the client restarts."
      : server
        ? openRuns
          ? `Factory restarts while ${openRuns} open Run${openRuns === 1 ? "" : "s"} keep going.`
          : "Factory restarts and open Runs keep going."
        : "The desktop app restarts to apply the update.";
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        title={title}
        description={description}
        actions={
          <>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={onConfirm}>Upgrade</Button>
          </>
        }
      />
    </Dialog>
  );
}

/** What failed and which installation was kept; retrying checks every target again. */
export function UpgradeError({
  failure,
  targets,
  onClose,
  onRetry,
}: {
  failure: UpgradeFailure | null;
  targets: readonly UpgradeTarget[];
  onClose: () => void;
  onRetry: () => void;
}) {
  const messages = failure
    ? [failure.message]
    : targets.flatMap((target) =>
        target.update.state === "error" ? [`${targetTitle(target)}: ${target.update.message}`] : [],
      );
  return (
    <div className="grid w-80 max-w-[calc(100vw-2rem)] gap-3">
      <h2 className="text-base text-foreground">{failure?.title ?? "Update failed"}</h2>
      {messages.map((message) => (
        <p key={message} className="text-sm text-muted-foreground">
          {message}
        </p>
      ))}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button onClick={onRetry}>Retry</Button>
      </div>
    </div>
  );
}
