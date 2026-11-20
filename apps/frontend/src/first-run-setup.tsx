import { useEffect, useState, type ReactNode } from "react";
import {
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  Plug,
  TriangleAlert,
  Unplug,
  Workflow,
} from "lucide-react";
import type { DetectedT3, FirstRunSetup, T3Connection } from "@t3-factory/contracts";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { TextLink } from "@/components/ui/text-link";
import { Disclosure } from "@/components/disclosure";
import { GateScreen } from "@/components/gate-screen";
import { ProblemCard } from "@/components/problem-card";
import { SetupStepHeader } from "@/components/setup-step-header";
import { allowedAddress, T3AddressForm, T3AddressHelp } from "@/components/t3-address";
import { ConnectingScreen, MutationGate } from "./client-gate.tsx";
import { api } from "./api.ts";
import { useConnectionState, type ConnectionPresentation } from "./connection-state.tsx";
import { useRefreshSchedule } from "./refresh-schedule.ts";

/** How often a step without a detected T3 looks for one again. */
const detectionRecheckMs = 2000;

/**
 * The last full-window state before the application: until the host records First-run setup
 * as completed, no product route mounts. Completion is read only from the setup status, never
 * from the live connection, so a later T3 outage does not bring this screen back.
 */
export function FirstRunSetupGate({ children }: { children: ReactNode }) {
  const [setup, setSetup] = useState<FirstRunSetup | null>(null);
  const { failure, refresh } = useRefreshSchedule({
    read: api.getFirstRunSetup,
    apply: setSetup,
    intervalMs: detectionRecheckMs,
    watching: setup !== null && !setup.completed && !setup.detectedT3,
  });
  useEffect(() => {
    void refresh();
  }, [refresh]);
  if (setup?.completed) return children;
  if (setup) return <FirstRunSetupScreen detected={setup.detectedT3} onCheckAgain={refresh} />;
  if (failure)
    return (
      <GateScreen
        label="Setup status unavailable"
        icon={CircleAlert}
        title="Couldn’t read the setup status"
        description="Check that the Factory server is running, then check again."
      >
        <Button onClick={() => void refresh()}>Check again</Button>
      </GateScreen>
    );
  return <ConnectingScreen />;
}

function FirstRunSetupScreen({
  detected,
  onCheckAgain,
}: {
  detected: DetectedT3 | null;
  onCheckAgain: () => Promise<void>;
}) {
  const { presentation } = useConnectionState();
  const connected = presentation === "ready";
  return (
    <GateScreen
      size="wide"
      label="First-run setup"
      icon={Workflow}
      eyebrow="T3 Factory"
      title="Set up Factory"
      description="Two steps on this computer, about a minute. You do this once."
    >
      <ol className="grid gap-5">
        <li aria-current={connected ? undefined : "step"} className="grid gap-3">
          <SetupStepHeader
            number={1}
            state={connected ? "done" : "current"}
            title="Connect to T3"
            detail="Factory uses T3 on this computer to list projects and start Runs."
          />
          {!connected && <ConnectStep detected={detected} onCheckAgain={onCheckAgain} />}
        </li>
        <li aria-current={connected ? "step" : undefined} className="border-t pt-5">
          <SetupStepHeader
            number={2}
            state={connected ? "current" : "upcoming"}
            title="Install in your agents"
            detail="Adds Factory’s MCP server and skills to your agent harnesses."
          />
        </li>
      </ol>
    </GateScreen>
  );
}

const runningTitle = (detected: DetectedT3) =>
  detected.serverVersion
    ? `T3 ${detected.serverVersion} is running on this computer`
    : "T3 is running on this computer";

/**
 * Connect saves the address through the existing configure operation, then starts the existing
 * host authorization; waiting, reopening and advancing follow the live connection.
 */
function ConnectStep({
  detected,
  onCheckAgain,
}: {
  detected: DetectedT3 | null;
  onCheckAgain: () => Promise<void>;
}) {
  const { connection, presentation, setConnection } = useConnectionState();
  const [busy, setBusy] = useState(false);
  // Explanations of a failed attempt belong to an attempt made here, not to the saved state.
  const [attempted, setAttempted] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [draft, setDraft] = useState("");
  const invalid = !!draft.trim() && !allowedAddress(draft);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setOperationError("");
    await operation()
      .catch((cause: unknown) => setOperationError(String(cause)))
      .finally(() => setBusy(false));
  };
  const connect = (endpoint: string) =>
    run(async () => {
      setAttempted(true);
      setConnection(await api.configureConnection({ endpoint }));
      setConnection(await api.authorizeConnection());
    });
  const reopen = () =>
    run(async () => {
      setConnection(await api.openConnectionAuthorization());
    });
  const errorCard = operationError && (
    <ProblemCard
      tone="error"
      density="compact"
      title="Couldn’t connect to T3"
      details={operationError}
    />
  );
  const endpoint = connection?.endpoint;
  if (presentation === "authorization-required" && connection?.authorizationPending && endpoint)
    return (
      <div className="grid gap-3 pl-8.5">
        <T3Row
          title={
            detected?.endpoint === endpoint ? runningTitle(detected) : "T3 at the entered address"
          }
          endpoint={endpoint}
        >
          <span role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <LoaderCircle
              aria-hidden
              strokeWidth={1.5}
              className="size-3.5 animate-spin text-link motion-reduce:animate-none"
            />
            Waiting for approval
          </span>
        </T3Row>
        <ProblemCard
          tone="info"
          density="compact"
          title="Approve Factory in your browser"
          action={
            <MutationGate>
              <TextLink trailingIcon={ExternalLink} disabled={busy} onClick={() => void reopen()}>
                Reopen approval page
              </TextLink>
            </MutationGate>
          }
        >
          T3’s approval page is open in the browser on this computer. This screen moves on by itself
          once you approve.
        </ProblemCard>
        {errorCard}
      </div>
    );
  return (
    <div className="grid gap-3 pl-8.5">
      {!busy && (
        <AttemptProblem connection={connection} presentation={presentation} attempted={attempted} />
      )}
      {errorCard}
      {detected ? (
        <>
          <T3Row title={runningTitle(detected)} endpoint={detected.endpoint}>
            <MutationGate>
              <Button disabled={busy} onClick={() => void connect(detected.endpoint)}>
                Connect
              </Button>
            </MutationGate>
          </T3Row>
          <p className="text-2xs font-medium text-subtle-foreground">
            Connect opens T3’s approval page in your browser. Approve once; Factory remembers it.
          </p>
        </>
      ) : (
        <ProblemCard
          tone="error"
          density="compact"
          icon={Unplug}
          title="No running T3 found on this computer"
          action={<TextLink onClick={() => void onCheckAgain()}>Check again</TextLink>}
        >
          Start T3 Code here and this step finds it by itself — or enter its address below.
        </ProblemCard>
      )}
      <Disclosure label="Use another address · how to find it" defaultOpen={!detected}>
        <div className="pl-4.5">
          <T3AddressHelp invalid={invalid}>
            <T3AddressForm
              value={draft}
              invalid={invalid}
              disabled={busy}
              submitLabel="Save and connect"
              onChange={setDraft}
              onSave={() => void connect(draft.trim())}
            />
          </T3AddressHelp>
        </div>
      </Disclosure>
    </div>
  );
}

/** The connection's own explanation of why it is not Connected after an attempt from here. */
function AttemptProblem({
  connection,
  presentation,
  attempted,
}: {
  connection: T3Connection | null;
  presentation: ConnectionPresentation;
  attempted: boolean;
}) {
  if (!connection) return null;
  if (presentation === "incompatible")
    return (
      <ProblemCard
        tone="attention"
        density="compact"
        title="Update T3"
        details={connection.contract?.problems.join("\n") || undefined}
      >
        {connection.explanation}
      </ProblemCard>
    );
  if (!attempted || (presentation !== "authorization-required" && presentation !== "unavailable"))
    return null;
  return (
    <ProblemCard
      tone="attention"
      density="compact"
      icon={presentation === "unavailable" ? Unplug : TriangleAlert}
      title={presentation === "unavailable" ? "Factory can’t reach T3" : "Approval didn’t finish"}
    >
      {connection.explanation} Connect again to start over.
    </ProblemCard>
  );
}

function T3Row({
  title,
  endpoint,
  children,
}: {
  title: string;
  endpoint: string;
  children: ReactNode;
}) {
  return (
    <Surface tone="inset" className="flex items-center gap-3 p-3">
      <Plug aria-hidden strokeWidth={1.5} className="size-4 shrink-0 text-muted-foreground" />
      <div className="grid min-w-0 flex-1 gap-0.5 leading-normal">
        <span className="truncate text-sm font-medium text-foreground">{title}</span>
        <span className="truncate font-mono text-label text-subtle-foreground">{endpoint}</span>
      </div>
      {children}
    </Surface>
  );
}
