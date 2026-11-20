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
import type {
  DetectedT3,
  FirstRunSetup,
  ReportingInstallation,
  T3Connection,
} from "@t3-factory/contracts";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { TextLink } from "@/components/ui/text-link";
import { Disclosure } from "@/components/disclosure";
import { GateScreen } from "@/components/gate-screen";
import { HarnessRow } from "@/components/harness-row";
import { ReportingTargetProblem } from "@/components/reporting-target-problem";
import { StatusBadge } from "@/components/status-badge";
import { ProblemCard } from "@/components/problem-card";
import { SetupStepHeader } from "@/components/setup-step-header";
import { allowedAddress, T3AddressForm, T3AddressHelp } from "@/components/t3-address";
import { ConnectingScreen, MutationGate } from "./client-gate.tsx";
import { api } from "./api.ts";
import { useConnectionState, type ConnectionPresentation } from "./connection-state.tsx";
import { useRefreshSchedule } from "./refresh-schedule.ts";
import { installable, providerName, targetStatus, useReportingState } from "./reporting-state.tsx";

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
  if (setup)
    return <FirstRunSetupScreen setup={setup} onCheckAgain={refresh} onCompleted={setSetup} />;
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

/** The reporting targets step 2 installs into: a T3 provider with Factory reporting. */
const listedTarget = (target: ReportingInstallation) =>
  target.instances.length > 0 && target.status !== "unsupported";

const names = (providers: readonly string[]) =>
  new Intl.ListFormat("en", { type: "conjunction" }).format(providers.map(providerName));

function FirstRunSetupScreen({
  setup,
  onCheckAgain,
  onCompleted,
}: {
  setup: FirstRunSetup;
  onCheckAgain: () => Promise<void>;
  onCompleted: (setup: FirstRunSetup) => void;
}) {
  const { presentation } = useConnectionState();
  const { targets } = useReportingState();
  const connected = presentation === "ready";
  const listed = connected && targets ? targets.filter(listedTarget) : null;
  const ready = !!listed?.length && listed.every((target) => target.status === "installed");
  return (
    <GateScreen
      size="wide"
      label="First-run setup"
      icon={Workflow}
      eyebrow="T3 Factory"
      title={ready ? "Factory is ready" : "Set up Factory"}
      description={
        ready
          ? "You can start your first Run."
          : "Two steps on this computer, about a minute. You do this once."
      }
    >
      <ol className="grid gap-5">
        <li aria-current={connected ? undefined : "step"} className="grid gap-3">
          <ConnectStepHeader connected={connected} />
          {!connected && <ConnectStep detected={setup.detectedT3} onCheckAgain={onCheckAgain} />}
        </li>
        <li
          aria-current={connected && !ready ? "step" : undefined}
          className="grid gap-3 border-t pt-5"
        >
          <InstallStepHeader connected={connected} listed={listed} ready={ready} />
          {connected && !ready && (
            <InstallStep
              listed={listed}
              offInT3={setup.harnessesOffInT3}
              onCheckAgain={onCheckAgain}
            />
          )}
        </li>
      </ol>
      {ready && <ReadyStep onCompleted={onCompleted} />}
    </GateScreen>
  );
}

function ConnectStepHeader({ connected }: { connected: boolean }) {
  const { connection } = useConnectionState();
  const version = connection?.contract?.serverVersion;
  return connected ? (
    <SetupStepHeader
      number={1}
      state="done"
      title={version ? `Connected to T3 ${version}` : "Connected to T3"}
      detail={connection?.endpoint ?? ""}
    />
  ) : (
    <SetupStepHeader
      number={1}
      state="current"
      title="Connect to T3"
      detail="Factory uses T3 on this computer to list projects and start Runs."
    />
  );
}

const installReason =
  "Workers report back to Factory through its MCP server and the $factory-block skill.";

function InstallStepHeader({
  connected,
  listed,
  ready,
}: {
  connected: boolean;
  listed: readonly ReportingInstallation[] | null;
  ready: boolean;
}) {
  if (ready && listed)
    return (
      <SetupStepHeader
        number={2}
        state="done"
        title={`Installed in ${names(listed.map((target) => target.provider))}`}
        detail="factory-runtime MCP · $factory-block · factory-start-run · setup-factory"
      />
    );
  if (!connected)
    return (
      <SetupStepHeader
        number={2}
        state="upcoming"
        title="Install in your agents"
        detail="Adds Factory’s MCP server and skills to your agent harnesses."
      />
    );
  return (
    <SetupStepHeader
      number={2}
      state="current"
      title="Install in your agents"
      detail={
        listed?.length
          ? `${installReason} Factory found these harnesses enabled in T3:`
          : installReason
      }
    />
  );
}

/**
 * Installs into every listed harness through the shared reporting install, which runs the
 * targets in turn and updates each row in place; a failed target keeps its own error.
 */
function InstallStep({
  listed,
  offInT3,
  onCheckAgain,
}: {
  listed: readonly ReportingInstallation[] | null;
  offInT3: readonly string[];
  onCheckAgain: () => Promise<void>;
}) {
  const { targets, error, readDetails, refresh, running, failures, install } = useReportingState();
  // The shared read may still hold the answer from before T3 was Connected.
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    void refresh().finally(() => setChecked(true));
  }, [refresh]);
  const checkAgain = () => void Promise.all([refresh(), onCheckAgain()]);
  const caption = offInT3.length > 0 && (
    <p className="text-2xs font-medium text-subtle-foreground">
      {offInT3.length === 1
        ? `${names(offInT3)} is off in T3. Turn it on there to include it.`
        : `${names(offInT3)} are off in T3. Turn them on there to include them.`}
    </p>
  );
  let content: ReactNode;
  if (error)
    content = (
      <ProblemCard
        tone="error"
        density="compact"
        title="Couldn’t check your harnesses"
        details={readDetails}
        action={<TextLink onClick={checkAgain}>Check again</TextLink>}
      >
        Check that Factory is running, then check again.
      </ProblemCard>
    );
  else if (!listed || !checked)
    content = (
      <StatusBadge kind="checking" role="status">
        Checking harnesses…
      </StatusBadge>
    );
  else if (!listed.length)
    content = (
      <ProblemCard
        tone="attention"
        density="compact"
        title="Turn on a harness in T3"
        details={targets?.find((target) => target.instances.length === 0)?.message}
        action={<TextLink onClick={checkAgain}>Check again</TextLink>}
      >
        None of the harnesses Factory installs into is on in T3. Turn one on in T3’s settings, then
        check again.
      </ProblemCard>
    );
  else {
    const pending = listed.filter(installable);
    content = (
      <>
        <Surface tone="group" className="rounded-md">
          {listed.map((target) => (
            <HarnessRow
              key={target.id}
              name={providerName(target.provider)}
              paths={[target.path, target.skillsPath].filter((path) => path !== null)}
              status={targetStatus(target, running === target.id, !!failures[target.id])}
            />
          ))}
        </Surface>
        {listed.map((target) => (
          <ReportingTargetProblem
            key={target.id}
            target={target}
            failure={failures[target.id]}
            density="compact"
          />
        ))}
        <div className="flex items-start gap-3">
          {pending.length > 0 && (
            <MutationGate>
              <Button disabled={running !== null} onClick={() => void install(pending)}>
                {pending.length === 1
                  ? "Install in 1 harness"
                  : `Install in ${pending.length} harnesses`}
              </Button>
            </MutationGate>
          )}
          <div className="min-w-0 flex-1">
            <Disclosure label="What gets installed">
              <ul className="grid gap-1 pl-4.5 text-sm text-muted-foreground">
                <li>
                  Factory MCP (<code className="font-mono text-label">factory-runtime</code>) ·
                  required: workers report Block results through it.
                </li>
                <li>
                  <code className="font-mono text-label">$factory-block</code> skill · required: how
                  a worker does and reports one Block.
                </li>
                <li>
                  <code className="font-mono text-label">factory-start-run</code> skill · optional:
                  start a Run from an agent conversation.
                </li>
                <li>
                  <code className="font-mono text-label">setup-factory</code> skill · optional: set
                  up a repository’s tracker labels for Factory.
                </li>
              </ul>
            </Disclosure>
          </div>
        </div>
      </>
    );
  }
  return (
    <div className="grid gap-3 pl-8.5">
      {content}
      {caption}
    </div>
  );
}

/** Open Factory records completion on the host before the application opens. */
function ReadyStep({ onCompleted }: { onCompleted: (setup: FirstRunSetup) => void }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const complete = async () => {
    setBusy(true);
    setFailure("");
    await api
      .completeFirstRunSetup()
      .then(onCompleted, (cause: unknown) => setFailure(String(cause)))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <ProblemCard tone="info" density="compact" title="Open a new agent session">
        Sessions that are already open keep the tools they loaded at start. New sessions see
        Factory.
      </ProblemCard>
      {failure && (
        <ProblemCard tone="error" density="compact" title="Couldn’t finish setup" details={failure}>
          Factory could not record that setup is complete. Try again.
        </ProblemCard>
      )}
      <div className="flex justify-end">
        <MutationGate>
          <Button disabled={busy} onClick={() => void complete()}>
            Open Factory
          </Button>
        </MutationGate>
      </div>
    </>
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
