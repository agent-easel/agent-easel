import { useEffect, useState, type ReactNode } from "react";
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
import {
  REPORTING_DISCOVERY_REFUSED,
  REPORTING_NONE_ENABLED,
  type DetectedT3,
  type FirstRunSetup,
  type ReportingInstallation,
  type T3Connection,
} from "@t3-factory/contracts";
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
import { installable, providerName, targetStatus, useReportingState } from "./reporting-state.tsx";

/** How often a step without a detected T3 looks for one again. */
const detectionRecheckMs = 2000;

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
    read: api.getFirstRunSetup,
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
  if (setup && remote) return <HostSetupProgressScreen onCheckAgain={refresh} />;
  if (setup)
    return <FirstRunSetupScreen setup={setup} onCheckAgain={refresh} onCompleted={completed} />;
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
  targets.some((target) => target.id === REPORTING_DISCOVERY_REFUSED) ||
  (listed.length > 0 && !listed.some(installable));

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
  const ready = installedEverywhere(listed);
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
              onCompleted={onCompleted}
            />
          )}
        </li>
      </ol>
      {ready && <ReadyStep reminder onCompleted={onCompleted} />}
    </GateScreen>
  );
}

function ConnectStepHeader({
  connected,
  detail = "Factory uses T3 on this computer to list projects and start Runs.",
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
      title={version ? `Connected to T3 ${version}` : "Connected to T3"}
      detail={connection?.endpoint ?? ""}
    />
  ) : (
    <SetupStepHeader number={1} state="current" title="Connect to T3" detail={detail} />
  );
}

const installReason =
  "Workers report back to Factory through its MCP server and the $factory-block skill.";

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
            ? "factory-runtime MCP · $factory-block · factory-start-run · setup-factory"
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
          waiting?.upcoming ?? "Adds Factory’s MCP server and skills to your agent harnesses."
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
          ? `${installReason} Factory found these harnesses enabled in T3:`
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
function HostSetupProgressScreen({ onCheckAgain }: { onCheckAgain: () => Promise<void> }) {
  const { connection, presentation } = useConnectionState();
  const { targets, refresh } = useReportingState();
  const connected = presentation === "ready";
  const listed = connected && targets ? targets.filter(listedTarget) : null;
  const installed = installedEverywhere(listed);
  const manual = !!targets && !!listed && nothingToInstall(targets, listed);
  // The shared reporting read may still hold the answer from before the host Connected.
  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);
  return (
    <GateScreen
      size="wide"
      label="First-run setup"
      icon={Lock}
      title="Finish setup on the Factory host"
      description="This device is approved, but connecting to T3 and installing in agents happen on the computer where Factory runs. Open Factory there; this screen updates by itself."
    >
      <ol aria-live="polite" className="grid gap-5">
        <li aria-current={connected ? undefined : "step"} className="grid gap-3">
          <ConnectStepHeader
            connected={connected}
            detail={
              connection?.authorizationPending
                ? "Waiting for approval on the Factory host"
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
                ? "Factory can’t install here; waiting for the Factory host to open Factory"
                : "Waiting for the install on the Factory host",
            }}
          />
          {connected && !installed && !!listed?.length && (
            <HarnessList listed={listed} className="ml-8.5" />
          )}
        </li>
      </ol>
      <div className="flex justify-end">
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
  offInT3,
  onCheckAgain,
  onCompleted,
}: {
  listed: readonly ReportingInstallation[] | null;
  offInT3: readonly string[];
  onCheckAgain: () => Promise<void>;
  onCompleted: (setup: FirstRunSetup) => void;
}) {
  const { targets, error, readDetails, refresh } = useReportingState();
  // The shared read may still hold the answer from before T3 was Connected, and a harness turned
  // on or off in T3 changes the caption: the list is read again with it.
  const [checked, setChecked] = useState(false);
  const offKey = offInT3.join(" ");
  useEffect(() => {
    void refresh().finally(() => setChecked(true));
  }, [refresh, offKey]);
  const checkAgain = () => void Promise.all([refresh(), onCheckAgain()]);
  // Discovery could not read T3's harnesses: turning one on in T3 would not help.
  const refusal = targets?.find((target) => target.id === REPORTING_DISCOVERY_REFUSED);
  const caption = !refusal && offInT3.length > 0 && (
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
  else if (refusal)
    content = (
      <>
        <ProblemCard
          tone="attention"
          density="compact"
          title="Couldn’t check your harnesses"
          action={<TextLink onClick={checkAgain}>Check again</TextLink>}
        >
          {refusal.message}
        </ProblemCard>
        <ReadyStep reminder={false} onCompleted={onCompleted} />
      </>
    );
  else if (!listed.length)
    content = (
      <ProblemCard
        tone="attention"
        density="compact"
        title="Turn on a harness in T3"
        details={targets?.find((target) => target.id === REPORTING_NONE_ENABLED)?.message}
        action={<TextLink onClick={checkAgain}>Check again</TextLink>}
      >
        None of the harnesses Factory installs into is on in T3. Turn one on in T3’s settings, then
        check again.
      </ProblemCard>
    );
  else content = <HarnessInstall listed={listed} onCompleted={onCompleted} />;
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
  onCompleted,
}: {
  listed: readonly ReportingInstallation[];
  onCompleted: (setup: FirstRunSetup) => void;
}) {
  const { running, failures, install } = useReportingState();
  const pending = listed.filter(installable);
  return (
    <>
      <HarnessList listed={listed} />
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
                <code className="font-mono text-label">$factory-block</code> skill · required: how a
                worker does and reports one Block.
              </li>
              <li>
                <code className="font-mono text-label">factory-start-run</code> skill · optional:
                start a Run from an agent conversation.
              </li>
              <li>
                <code className="font-mono text-label">setup-factory</code> skill · optional: set up
                a repository’s tracker labels for Factory.
              </li>
            </ul>
          </Disclosure>
        </div>
      </div>
      {pending.length === 0 && (
        <ReadyStep
          reminder={listed.some((target) => target.status === "installed")}
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

/** Open Factory records completion on the host before the application opens. */
function ReadyStep({
  reminder,
  onCompleted,
}: {
  /** Something was installed, so new agent sessions are needed to load it. */
  reminder: boolean;
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
          Factory.
        </ProblemCard>
      )}
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

/** One step action at a time, with its failure shown below the step. */
function useStepOperation() {
  const [busy, setBusy] = useState(false);
  const [operationError, setOperationError] = useState("");
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setOperationError("");
    await operation()
      .catch((cause: unknown) => setOperationError(String(cause)))
      .finally(() => setBusy(false));
  };
  const errorCard = operationError && (
    <ProblemCard
      tone="error"
      density="compact"
      title="Couldn’t connect to T3"
      details={operationError}
    />
  );
  return { busy, run, errorCard };
}

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
  const { busy, run, errorCard } = useStepOperation();
  const [draft, setDraft] = useState("");
  const invalid = !!draft.trim() && !allowedAddress(draft);
  const connect = (endpoint: string) =>
    run(async () => {
      setConnection(await api.configureConnection({ endpoint }));
      setConnection(await api.authorizeConnection());
    });
  if (presentation === "authorization-required" && connection?.authorizationPending)
    return <WaitingForApproval connection={connection} detected={detected} />;
  return (
    <div className="grid gap-3 pl-8.5">
      {!busy && <AttemptProblem connection={connection} presentation={presentation} />}
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
              onChange={setDraft}
              onSave={() => void connect(draft.trim())}
            />
          </T3AddressHelp>
        </div>
      </Disclosure>
    </div>
  );
}

/** Figma F03: approval waits in the host's browser, which Reopen asks to open again. */
function WaitingForApproval({
  connection,
  detected,
}: {
  connection: T3Connection;
  detected: DetectedT3 | null;
}) {
  const { setConnection } = useConnectionState();
  const { busy, run, errorCard } = useStepOperation();
  const reopen = () => run(async () => setConnection(await api.openConnectionAuthorization()));
  // The host reports a failed open to every window until an open succeeds or approval ends.
  const reopenFailed = connection.authorizationOpenFailed;
  const endpoint = connection.endpoint ?? "";
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
        tone={reopenFailed ? "attention" : "info"}
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
        {reopenFailed
          ? connection.explanation
          : "T3’s approval page is open in the browser on this computer. This screen moves on by itself once you approve."}
      </ProblemCard>
      {errorCard}
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
}: {
  connection: T3Connection | null;
  presentation: ConnectionPresentation;
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
