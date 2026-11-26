import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  Lock,
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
  T3ConnectionRecovery,
} from "@agent-easel/contracts";
import { productPositioning, productStatement } from "@agent-easel/contracts";
import { cn } from "@/lib/utils";
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
import { useClientScope } from "./client-scope.ts";
import { useConnectionState, type ConnectionPresentation } from "./connection-state.tsx";
import { useRefreshSchedule } from "./refresh-schedule.ts";
import {
  createDiagnosticRetry,
  useDiagnosticLogStatus,
  useDiagnosticRetry,
  type DiagnosticRetry,
} from "./diagnostic-log.ts";
import { DiagnosticLogViewer, DiagnosticRetryAction } from "@/components/diagnostic-log-view";
import { installable, providerName, targetStatus, useReportingState } from "./reporting-state.tsx";

/** How often a step without a detected T3 looks for one again. */
const detectionRecheckMs = 2000;

/** Where the documentation describes the reporting entries, for setting them up by hand. */
const MANUAL_REPORTING_URL =
  "https://github.com/agent-easel/agent-easel/blob/main/docs/t3-integration.md#reporting-installation";

/**
 * The last full-window state before the application: until the host records First-run setup
 * as completed, no product route mounts. Completion is read only from the setup status, never
 * from the live connection, so a later T3 outage does not bring this screen back. The status is
 * re-read while visible until completed: approved clients wait for the host to complete it, and
 * the host follows T3's detection and the harnesses T3 keeps off.
 */
export function FirstRunSetupGate({ children }: { children: ReactNode }) {
  const remote = useClientScope() === "remote";
  const [setup, setSetup] = useState<FirstRunSetup | null>(null);
  const { failure, refresh, supersede } = useRefreshSchedule({
    read: () => api.getFirstRunSetup(""),
    readWhileWatching: () => api.getFirstRunSetup("1"),
    apply: setSetup,
    intervalMs: detectionRecheckMs,
    watching: setup !== null && !setup.completed,
  });
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // A read that started before completion was recorded must not reopen the screen.
  const completed = (recorded: FirstRunSetup) => {
    supersede();
    setSetup(recorded);
  };
  if (setup?.completed) return children;
  if (setup && remote) return <HostSetupProgressScreen setup={setup} onCheckAgain={refresh} />;
  if (setup)
    return <FirstRunSetupScreen setup={setup} onCheckAgain={refresh} onCompleted={completed} />;
  if (failure)
    return (
      <GateScreen
        label="Setup status unavailable"
        icon={CircleAlert}
        title="Couldn’t read the setup status"
        description="Check that the AgentEasel server is running, then check again."
      >
        <Button onClick={() => void refresh()}>Check again</Button>
      </GateScreen>
    );
  return <ConnectingScreen />;
}

/** The reporting targets step 2 installs into: a T3 provider with Factory reporting. */
const listedTarget = (target: ReportingInstallation) =>
  target.kind === "instance" && target.status !== "unsupported";

const installedEverywhere = (listed: readonly ReportingInstallation[] | null) =>
  !!listed?.length && listed.every((target) => target.status === "installed");

/**
 * Installation is impossible, so the host may open Factory without it: discovery refused, or the
 * list is not empty and nothing in it still offers Install or Repair. Installable harnesses are
 * installed first. An empty list keeps the step, since turning a harness on in T3 fixes it.
 */
const nothingToInstall = (
  targets: readonly ReportingInstallation[],
  listed: readonly ReportingInstallation[],
) =>
  targets.some((target) => target.kind === "discovery-refused") ||
  (listed.length > 0 && !listed.some(installable));

/**
 * The connection and reporting list both setup screens follow. The list is read again for every
 * ready connection (each connect, reauthorization, reconnect or endpoint change is a new ready
 * generation) and whenever the harnesses T3 keeps off change. It is `listed` only once a read
 * requested for the current generation and caption has applied; a later read for the same request
 * keeps it in view. It is `current` while no newer read is outstanding as well: Open Factory and
 * an approved client's status rest on that.
 */
function useSetupProgress(setup: FirstRunSetup) {
  const { connection, presentation } = useConnectionState();
  const { targets, refreshFor, answeredFor, refreshing } = useReportingState();
  const connected = presentation === "ready";
  const generation = connected ? connection?.readyGeneration : null;
  const key = generation
    ? JSON.stringify([generation, setup.harnessesOffInT3, setup.reportingEligibility])
    : null;
  useLayoutEffect(() => {
    void refreshFor(key);
    return () => void refreshFor(null);
  }, [key, refreshFor]);
  const answered = key !== null && answeredFor === key;
  const listed = answered && targets ? targets.filter(listedTarget) : null;
  return { connected, targets, listed, current: answered && !refreshing };
}

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
  const { connected, listed, current } = useSetupProgress(setup);
  const ready = installedEverywhere(listed);
  const retry = useDiagnosticRetry();
  return (
    <GateScreen
      size="wide"
      label="First-run setup"
      icon={Workflow}
      eyebrow="AgentEasel"
      title={ready ? "AgentEasel is ready" : "Set up AgentEasel"}
      description={
        ready
          ? "You can start your first Run."
          : "Two steps on this computer, about a minute. You do this once."
      }
    >
      <ol className="grid gap-5">
        <li aria-current={connected ? undefined : "step"} className="grid gap-3">
          <ConnectStepHeader connected={connected} />
          <ConnectStep
            connected={connected}
            detected={setup.detectedT3}
            onCheckAgain={onCheckAgain}
          />
        </li>
        <li
          aria-current={connected && !ready ? "step" : undefined}
          className="grid gap-3 border-t pt-5"
        >
          <InstallStepHeader connected={connected} listed={listed} ready={ready} />
          {connected && !ready && (
            <InstallStep
              listed={listed}
              current={current}
              offInT3={setup.harnessesOffInT3}
              onCheckAgain={onCheckAgain}
              onCompleted={onCompleted}
              retry={retry}
            />
          )}
          {ready && retry.attempts && (
            <div className="pl-8.5">
              <DiagnosticLogViewer attempts={retry.attempts} />
            </div>
          )}
        </li>
      </ol>
      {retry.error && (
        <ProblemCard tone="error" title="Couldn’t record the diagnostic log">
          {retry.error}
        </ProblemCard>
      )}
      {ready && <ReadyStep reminder current={current} onCompleted={onCompleted} />}
    </GateScreen>
  );
}

function ConnectStepHeader({
  connected,
  detail = "AgentEasel uses T3 Code on this computer to list projects and start Runs.",
}: {
  connected: boolean;
  /** The current step's sentence. */
  detail?: string;
}) {
  const { connection } = useConnectionState();
  const version = connection?.contract?.serverVersion;
  return connected ? (
    <SetupStepHeader
      number={1}
      state="done"
      title={version ? `Connected to T3 Code ${version}` : "Connected to T3 Code"}
      detail={connection?.endpoint ?? ""}
    />
  ) : (
    <SetupStepHeader number={1} state="current" title="Connect to T3 Code" detail={detail} />
  );
}

const installReason =
  "Workers report back to AgentEasel through its MCP server and the $factory-block skill.";

function InstallStepHeader({
  connected,
  listed,
  ready,
  waiting,
}: {
  connected: boolean;
  listed: readonly ReportingInstallation[] | null;
  ready: boolean;
  /** An approved client's sentences: it waits for each step on the host. */
  waiting?: { upcoming: string; current: string };
}) {
  if (ready && listed)
    return (
      <SetupStepHeader
        number={2}
        state="done"
        title={`Installed in ${names(listed.map((target) => target.provider))}`}
        detail={
          // Reporting is installed without the optional skills when their copies are missing or old.
          listed.every((target) => target.launchSkill === "current")
            ? "factory-runtime MCP · $factory-block · factory-start-run · setup-factory · factory-configure"
            : "factory-runtime MCP · $factory-block"
        }
      />
    );
  if (!connected)
    return (
      <SetupStepHeader
        number={2}
        state="upcoming"
        title="Install in your agents"
        detail={
          waiting?.upcoming ?? "Adds AgentEasel’s MCP server and skills to your agent harnesses."
        }
      />
    );
  if (waiting)
    return (
      <SetupStepHeader
        number={2}
        state="current"
        title="Install in your agents"
        detail={waiting.current}
      />
    );
  return (
    <SetupStepHeader
      number={2}
      state="current"
      title="Install in your agents"
      detail={
        listed?.length
          ? `${installReason} AgentEasel found these harnesses enabled in T3 Code:`
          : installReason
      }
    />
  );
}

/**
 * Figma F06: an approved client sees the host's progress through both steps without any of the
 * host's actions: only the host saves the endpoint, authorizes or completes setup, and
 * installing belongs with it. Progress comes from the host screen's connection and reporting reads.
 */
function HostSetupProgressScreen({
  setup,
  onCheckAgain,
}: {
  setup: FirstRunSetup;
  onCheckAgain: () => Promise<void>;
}) {
  const { connection } = useConnectionState();
  const { refresh } = useReportingState();
  const { connected, targets, listed, current } = useSetupProgress(setup);
  const installed = installedEverywhere(listed);
  const manual = current && !!targets && !!listed && nothingToInstall(targets, listed);
  const diagnostics = useDiagnosticLogStatus();
  return (
    <GateScreen
      size="wide"
      label="First-run setup"
      icon={Lock}
      title="Finish setup on the AgentEasel host"
      description="This device is approved, but connecting to T3 Code and installing in agents happen on the computer where AgentEasel runs. Open AgentEasel there; this screen updates by itself."
    >
      <ol aria-live="polite" className="grid gap-5">
        <li aria-current={connected ? undefined : "step"} className="grid gap-3">
          <ConnectStepHeader
            connected={connected}
            detail={
              connection?.authorizationPending
                ? "Waiting for approval on the AgentEasel host"
                : "Not connected yet"
            }
          />
        </li>
        <li
          aria-current={connected && !installed ? "step" : undefined}
          className="grid gap-3 border-t pt-5"
        >
          <InstallStepHeader
            connected={connected}
            listed={listed}
            ready={installed}
            waiting={{
              upcoming: "Waiting for step 1",
              current: manual
                ? "AgentEasel can’t install here; waiting for the AgentEasel host to open AgentEasel"
                : "Waiting for the install on the AgentEasel host",
            }}
          />
          {connected && !installed && !!listed?.length && (
            <HarnessList listed={listed} className="ml-8.5" />
          )}
        </li>
      </ol>
      <div className="flex items-center justify-end gap-3">
        {diagnostics && (diagnostics.enabled || diagnostics.hasEntries) && (
          <DiagnosticLogViewer attempts={null} />
        )}
        <Button
          variant="outline"
          onClick={() => void Promise.all([onCheckAgain(), connected && refresh()])}
        >
          Check again
        </Button>
      </div>
    </GateScreen>
  );
}

/**
 * Installs into every listed harness through the shared reporting install, which runs the
 * targets in turn and updates each row in place; a failed target keeps its own error.
 */
function InstallStep({
  listed,
  current,
  offInT3,
  onCheckAgain,
  onCompleted,
  retry,
}: {
  /** Null until a reporting read requested for the ready connection and its caption has applied. */
  listed: readonly ReportingInstallation[] | null;
  /** `listed` answers the ready connection and caption, and no newer read is outstanding. */
  current: boolean;
  offInT3: readonly string[];
  onCheckAgain: () => Promise<void>;
  onCompleted: (setup: FirstRunSetup) => void;
  retry: DiagnosticRetry;
}) {
  const { targets, error, readDetails, recheck } = useReportingState();
  const checkAgain = () => void Promise.allSettled([recheck(), onCheckAgain()]);
  const checkActions = (
    <span className="inline-flex flex-wrap gap-x-3">
      <TextLink disabled={retry.busy} onClick={checkAgain}>
        Check again
      </TextLink>
      <DiagnosticRetryAction retry={retry} recover={recheck} view />
    </span>
  );
  // Discovery could not read T3's harnesses: turning one on in T3 would not help.
  const refusal = listed && targets?.find((target) => target.kind === "discovery-refused");
  const caption = !refusal && offInT3.length > 0 && (
    <p className="text-2xs font-medium text-subtle-foreground">
      {offInT3.length === 1
        ? `${names(offInT3)} is off in T3 Code. Turn it on there to include it.`
        : `${names(offInT3)} are off in T3 Code. Turn them on there to include them.`}
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
        action={checkActions}
      >
        Check that AgentEasel is running, then check again.
      </ProblemCard>
    );
  else if (!listed)
    content = (
      <StatusBadge kind="checking" role="status">
        Checking harnesses…
      </StatusBadge>
    );
  else if (refusal)
    content = (
      <>
        <ProblemCard
          tone="attention"
          density="compact"
          title="Couldn’t check your harnesses"
          action={checkActions}
        >
          {refusal.message} Open AgentEasel to continue without reporting. Once this is fixed,
          install it from Settings → Agent reporting, or{" "}
          <TextLink href={MANUAL_REPORTING_URL}>set it up by hand</TextLink>.
        </ProblemCard>
        <ReadyStep reminder={false} current={current} onCompleted={onCompleted} />
      </>
    );
  else if (!listed.length)
    content = (
      <ProblemCard
        tone="attention"
        density="compact"
        title="Turn on a harness in T3 Code"
        details={targets?.find((target) => target.kind === "none-enabled")?.message}
        action={checkActions}
      >
        None of the harnesses AgentEasel installs into is on in T3 Code. Turn one on in T3 Code’s
        settings, then check again.
      </ProblemCard>
    );
  else
    content = (
      <HarnessInstall listed={listed} current={current} onCompleted={onCompleted} retry={retry} />
    );
  return (
    <div className="grid gap-3 pl-8.5">
      {content}
      {caption}
    </div>
  );
}

/**
 * The listed harnesses and the install for those that offer Install or Repair. Once none does,
 * the rest need manual setup and the host may open Factory.
 */
function HarnessInstall({
  listed,
  current,
  onCompleted,
  retry,
}: {
  listed: readonly ReportingInstallation[];
  current: boolean;
  onCompleted: (setup: FirstRunSetup) => void;
  retry: DiagnosticRetry;
}) {
  const { running, failures, install, retryTarget } = useReportingState();
  const pending = listed.filter(installable);
  const cardShown = listed.some(
    (target) => failures[target.id] || target.status === "needs-attention",
  );
  return (
    <>
      <HarnessList listed={listed} />
      {listed.map((target) => (
        <ReportingTargetProblem
          key={target.id}
          target={target}
          failure={failures[target.id]}
          density="compact"
          action={
            (retry.offer || retry.attempts) && (
              <DiagnosticRetryAction
                retry={retry}
                disabled={running !== null}
                recover={(signal) => retryTarget(target, signal)}
                view
              />
            )
          }
        />
      ))}
      {!cardShown && retry.attempts && <DiagnosticLogViewer attempts={retry.attempts} />}
      <div className="flex items-start gap-3">
        {pending.length > 0 && (
          <MutationGate>
            <Button disabled={running !== null || retry.busy} onClick={() => void install(pending)}>
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
                AgentEasel MCP (<code className="font-mono text-label">factory-runtime</code>) ·
                required: workers report Block results through it.
              </li>
              <li>
                <code className="font-mono text-label">$factory-block</code> skill · required: how a
                worker does and reports one Block.
              </li>
              <li>
                <code className="font-mono text-label">factory-start-run</code> skill · optional:
                start a Run from an agent conversation.
              </li>
              <li>
                <code className="font-mono text-label">setup-factory</code> skill · optional: set up
                a repository’s tracker labels for AgentEasel.
              </li>
              <li>
                <code className="font-mono text-label">factory-configure</code> skill · optional:
                change Agents, Flows and Triggers from an agent conversation.
              </li>
            </ul>
          </Disclosure>
        </div>
      </div>
      {pending.length === 0 && (
        <ReadyStep
          reminder={listed.some((target) => target.status === "installed")}
          current={current}
          onCompleted={onCompleted}
        />
      )}
    </>
  );
}

/**
 * The listed harnesses with each one's paths, message and live install status. A target needing
 * attention or whose install failed explains itself in its problem card instead.
 */
function HarnessList({
  listed,
  className,
}: {
  listed: readonly ReportingInstallation[];
  className?: string;
}) {
  const { running, failures } = useReportingState();
  return (
    <Surface tone="group" className={cn("rounded-md", className)}>
      {listed.map((target) => (
        <HarnessRow
          key={target.id}
          name={providerName(target.provider)}
          paths={[target.path, target.skillsPath].filter((path) => path !== null)}
          message={
            target.status === "needs-attention" || failures[target.id] ? undefined : target.message
          }
          status={targetStatus(target, running === target.id, !!failures[target.id])}
        />
      ))}
    </Surface>
  );
}

/**
 * Open Factory records completion on the host before the application opens. It waits while the
 * reporting list it rests on is being read again, since that read can bring something to install.
 */
function ReadyStep({
  reminder,
  current,
  onCompleted,
}: {
  /** Something was installed, so new agent sessions are needed to load it. */
  reminder: boolean;
  /** The reporting list Open Factory rests on is current; until then it is disabled. */
  current: boolean;
  onCompleted: (setup: FirstRunSetup) => void;
}) {
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
      {reminder && (
        <ProblemCard tone="info" density="compact" title="Open a new agent session">
          Sessions that are already open keep the tools they loaded at start. New sessions see
          AgentEasel.
        </ProblemCard>
      )}
      {failure && (
        <ProblemCard tone="error" density="compact" title="Couldn’t finish setup" details={failure}>
          AgentEasel could not record that setup is complete. Try again.
        </ProblemCard>
      )}
      <div className="flex justify-end">
        <MutationGate>
          <Button disabled={busy || !current} onClick={() => void complete()}>
            Open AgentEasel
          </Button>
        </MutationGate>
      </div>
    </>
  );
}

const runningTitle = (detected: DetectedT3) =>
  detected.serverVersion
    ? `T3 Code ${detected.serverVersion} is running on this computer`
    : "T3 Code is running on this computer";

function useConnectRecovery(setConnection: (value: T3Connection) => void) {
  const [busy, setBusy] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [retry] = useState(createDiagnosticRetry);
  const attempts = useSyncExternalStore(retry.subscribe, retry.getSnapshot);
  const canRecord = useDiagnosticLogStatus(attempts)?.enabled === false;
  const run = (recover: () => Promise<readonly string[]>, record = false) => {
    setBusy(true);
    setOperationError("");
    return (record ? retry.retry(recover) : recover())
      .catch((cause: unknown) => setOperationError(String(cause)))
      .finally(() => setBusy(false));
  };
  const update = async (result: Promise<T3ConnectionRecovery>) => {
    const value = await result;
    setConnection(value);
    return value.diagnosticAttemptIds ?? [];
  };
  const connect = async (endpoint: string) => {
    const checked = await update(api.configureConnection({ endpoint }));
    return [...checked, ...(await update(api.authorizeConnection()))];
  };
  return { attempts, busy, canRecord, connect, operationError, run, update };
}

/**
 * Connect saves the address through the existing configure operation, then starts the existing
 * host authorization; waiting, reopening and advancing follow the live connection.
 */
function ConnectStep({
  connected,
  detected,
  onCheckAgain,
}: {
  connected: boolean;
  detected: DetectedT3 | null;
  onCheckAgain: () => Promise<void>;
}) {
  const { connection, presentation, setConnection } = useConnectionState();
  const { attempts, busy, canRecord, connect, operationError, run, update } =
    useConnectRecovery(setConnection);
  const [draft, setDraft] = useState("");
  const viewLog = attempts !== null && <DiagnosticLogViewer attempts={attempts} />;
  if (connected) return viewLog && <div className="pl-8.5">{viewLog}</div>;

  const reopen = () => update(api.openConnectionAuthorization());
  const errorCard = operationError && (
    <ProblemCard
      tone="error"
      density="compact"
      title="Couldn’t connect to T3 Code"
      details={operationError}
    />
  );
  if (presentation === "authorization-required" && connection?.authorizationPending)
    return (
      <WaitingForApproval
        connection={connection}
        detected={detected}
        disabled={busy}
        diagnosticAction={
          <ConnectDiagnosticActions
            viewer={viewLog}
            disabled={busy}
            canRecord={canRecord && connection.authorizationOpenFailed}
            onRecord={() => void run(reopen, true)}
          />
        }
        onReopen={() => void run(reopen)}
      >
        {errorCard}
      </WaitingForApproval>
    );

  const endpoint = connection?.endpoint;
  const authorize = () => update(api.authorizeConnection());
  const needsApproval = presentation === "authorization-required";
  const recheck = () => update(api.recheckConnection());
  const retryConnection = needsApproval ? authorize : recheck;
  const actions = endpoint && (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <MutationGate>
        <TextLink disabled={busy} onClick={() => void run(retryConnection)}>
          {needsApproval ? "Connect again" : "Recheck connection"}
        </TextLink>
      </MutationGate>
      <ConnectDiagnosticActions
        viewer={viewLog}
        disabled={busy}
        canRecord={canRecord}
        onRecord={() => void run(retryConnection, true)}
      />
    </div>
  );
  return (
    <div className="grid gap-3 pl-8.5">
      <p className="text-2xs font-medium text-subtle-foreground">{productPositioning}</p>
      <p className="text-2xs font-medium text-subtle-foreground">{productStatement}</p>
      <AttemptProblem connection={connection} presentation={presentation} action={actions} />
      {errorCard}
      <ConnectAddress
        detected={detected}
        busy={busy}
        draft={draft}
        onDraftChange={setDraft}
        onConnect={(endpoint) => void run(() => connect(endpoint))}
        onCheckAgain={onCheckAgain}
      />
    </div>
  );
}

function ConnectDiagnosticActions({
  viewer,
  disabled,
  canRecord,
  onRecord,
}: {
  viewer: ReactNode;
  disabled: boolean;
  canRecord: boolean;
  onRecord: () => void;
}) {
  return (
    <>
      {canRecord && (
        <MutationGate>
          <TextLink disabled={disabled} onClick={onRecord}>
            Record diagnostic log and try again
          </TextLink>
        </MutationGate>
      )}
      {viewer}
    </>
  );
}

function ConnectAddress({
  detected,
  busy,
  draft,
  onDraftChange,
  onConnect,
  onCheckAgain,
}: {
  detected: DetectedT3 | null;
  busy: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onConnect: (endpoint: string) => void;
  onCheckAgain: () => Promise<void>;
}) {
  const invalid = !!draft.trim() && !allowedAddress(draft);
  return (
    <>
      {detected ? (
        <>
          <T3Row title={runningTitle(detected)} endpoint={detected.endpoint}>
            <MutationGate>
              <Button disabled={busy} onClick={() => onConnect(detected.endpoint)}>
                Connect
              </Button>
            </MutationGate>
          </T3Row>
          <p className="text-2xs font-medium text-subtle-foreground">
            Connect opens T3 Code’s approval page in your browser. Approve once; AgentEasel
            remembers it.
          </p>
        </>
      ) : (
        <ProblemCard
          tone="error"
          density="compact"
          icon={Unplug}
          title="No running T3 Code found on this computer"
          action={<TextLink onClick={() => void onCheckAgain()}>Check again</TextLink>}
        >
          Start T3 Code here and this step finds it by itself — or enter its address below.
        </ProblemCard>
      )}
      {/* Remounted when detection changes, so each state starts as its design opens it. */}
      <Disclosure
        key={detected ? "detected" : "not-found"}
        label="Use another address · how to find it"
        defaultOpen={!detected}
      >
        <div className="pl-4.5">
          <T3AddressHelp invalid={invalid}>
            <T3AddressForm
              value={draft}
              invalid={invalid}
              disabled={busy}
              submitLabel="Save and connect"
              onChange={onDraftChange}
              onSave={() => onConnect(draft.trim())}
            />
          </T3AddressHelp>
        </div>
      </Disclosure>
    </>
  );
}

/** Figma F03: approval waits in the host's browser, which Reopen asks to open again. */
function WaitingForApproval({
  connection,
  detected,
  disabled,
  diagnosticAction,
  onReopen,
  children,
}: {
  connection: T3Connection;
  detected: DetectedT3 | null;
  disabled: boolean;
  diagnosticAction: ReactNode;
  onReopen: () => void;
  children: ReactNode;
}) {
  // The host reports a failed open to every window until an open succeeds or approval ends.
  const reopenFailed = connection.authorizationOpenFailed;
  const endpoint = connection.endpoint ?? "";
  return (
    <div className="grid gap-3 pl-8.5">
      <T3Row
        title={
          detected?.endpoint === endpoint
            ? runningTitle(detected)
            : "T3 Code at the entered address"
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
        tone={reopenFailed ? "attention" : "info"}
        density="compact"
        title="Approve AgentEasel in your browser"
        action={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <MutationGate>
              <TextLink trailingIcon={ExternalLink} disabled={disabled} onClick={onReopen}>
                Reopen approval page
              </TextLink>
            </MutationGate>
            {diagnosticAction}
          </div>
        }
      >
        {reopenFailed
          ? connection.explanation
          : "T3 Code’s approval page is open in the browser on this computer. This screen moves on by itself once you approve."}
      </ProblemCard>
      {children}
    </div>
  );
}

/**
 * The connection's own explanation of why it is not Connected. A fresh host has no saved address,
 * so a saved one means an attempt was made, here, before a reload or in another host window.
 */
function AttemptProblem({
  connection,
  presentation,
  action,
}: {
  connection: T3Connection | null;
  presentation: ConnectionPresentation;
  action: ReactNode;
}) {
  if (!connection) return null;
  if (presentation === "incompatible")
    return (
      <ProblemCard
        tone="attention"
        density="compact"
        title="Update T3 Code"
        action={action}
        details={connection.contract?.problems.join("\n") || undefined}
      >
        {connection.explanation}
      </ProblemCard>
    );
  if (
    !connection.endpoint ||
    (presentation !== "authorization-required" && presentation !== "unavailable")
  )
    return null;
  return (
    <ProblemCard
      tone="attention"
      density="compact"
      icon={presentation === "unavailable" ? Unplug : TriangleAlert}
      title={
        presentation === "unavailable" ? "AgentEasel can’t reach T3 Code" : "Approval didn’t finish"
      }
      action={action}
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
