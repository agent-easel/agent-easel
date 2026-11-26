import { MutationGate } from "@/client-gate";
import { useState, useSyncExternalStore } from "react";
import type { T3Connection, T3ConnectionRecovery } from "@agent-easel/contracts";
import { KeyRound, LoaderCircle, Unplug } from "lucide-react";
import { useClientScope } from "../client-scope.ts";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/ui/text-link";
import { DiagnosticLogViewer } from "@/components/diagnostic-log-view";
import { ProblemCard } from "@/components/problem-card";
import { TechnicalDetails } from "@/components/technical-details";
import { SettingsDetailRow, SettingsGroup, SettingsPage } from "@/components/settings-page";
import { StatusBadge } from "@/components/status-badge";
import { dayAndTime } from "../time-format.ts";
import { api } from "../api.ts";
import { createDiagnosticRetry, useDiagnosticLogStatus } from "../diagnostic-log.ts";
import {
  ConnectionStateBadge,
  useConnectionState,
  settingsConnectionPresentation,
  type SettingsConnectionPresentation,
} from "../connection-state.tsx";
import { allowedAddress, T3AddressForm, T3AddressHelp } from "../components/t3-address.tsx";

function useConnectionRecovery(setConnection: (value: T3Connection) => void) {
  const [busy, setBusy] = useState<"checking" | "changing" | null>(null);
  const [operationError, setOperationError] = useState("");
  const [retry] = useState(createDiagnosticRetry);
  const attempts = useSyncExternalStore(retry.subscribe, retry.getSnapshot);
  const diagnosticStatus = useDiagnosticLogStatus(attempts);
  const act = async (
    operation: () => Promise<T3ConnectionRecovery>,
    phase: "checking" | "changing" = "changing",
    record = false,
  ) => {
    setBusy(phase);
    setOperationError("");
    const recover = async () => {
      const result = await operation();
      setConnection(result);
      return result.diagnosticAttemptIds ?? [];
    };
    return await (record ? retry.retry(recover) : recover())
      .then(
        () => true,
        (cause: unknown) => {
          setOperationError(String(cause));
          return false;
        },
      )
      .finally(() => setBusy(null));
  };
  return { act, attempts, busy, diagnosticStatus, operationError };
}

export function ConnectionSettingsPanel() {
  const { connection, loadError, presentation: status, setConnection } = useConnectionState();
  const presentation = settingsConnectionPresentation(connection, status);
  const host = useClientScope() === "host";
  const { act, attempts, busy, diagnosticStatus, operationError } =
    useConnectionRecovery(setConnection);
  const disabled = busy !== null || presentation === "loading";
  const pending = presentation === "authorization-required" && connection?.authorizationPending;
  const authorize = host && !pending ? api.authorizeConnection : api.openConnectionAuthorization;
  const authorizing = presentation === "authorization-required";
  const recordedRetry = host && diagnosticStatus?.enabled === false && (
    <MutationGate>
      <TextLink
        disabled={disabled}
        onClick={() =>
          void act(
            authorizing ? authorize : api.recheckConnection,
            authorizing ? "changing" : "checking",
            true,
          )
        }
      >
        Record diagnostic log and try again
      </TextLink>
    </MutationGate>
  );
  return (
    <SettingsPage
      title="T3 Code connection"
      badge={<ConnectionStateBadge presentation={busy === "checking" ? "loading" : presentation} />}
      hostManaged={!host}
      action={
        <ConnectionHeaderActions
          attempts={attempts}
          disabled={disabled}
          presentation={presentation}
          onCheck={() => void act(api.recheckConnection, "checking")}
        />
      }
    >
      <ConnectionProblem
        connection={connection}
        presentation={presentation}
        error={loadError}
        retry={recordedRetry}
        action={
          <MutationGate>
            <Button
              variant={pending ? "outline" : "default"}
              disabled={disabled}
              onClick={() => void act(authorize)}
            >
              {pending ? "Open the page again" : "Authorize"}
            </Button>
          </MutationGate>
        }
      />
      {operationError && (
        <ProblemCard
          tone="error"
          title="Couldn’t change the T3 Code connection"
          details={operationError}
        />
      )}
      {presentation !== "load-error" && (
        <ConnectionRows
          connection={connection}
          presentation={presentation}
          host={host}
          disabled={disabled}
          act={act}
        />
      )}
      {presentation === "ready" && connection?.contract && (
        <TechnicalDetails details={contractDetails(connection)} />
      )}
    </SettingsPage>
  );
}

function ConnectionHeaderActions({
  attempts,
  disabled,
  presentation,
  onCheck,
}: {
  attempts: readonly string[] | null;
  disabled: boolean;
  presentation: SettingsConnectionPresentation;
  onCheck: () => void;
}) {
  const primary =
    presentation === "unavailable" ||
    presentation === "incompatible" ||
    presentation === "load-error";
  return (
    <>
      {attempts !== null && <DiagnosticLogViewer attempts={attempts} />}
      <MutationGate>
        <Button
          variant={primary ? "default" : "outline"}
          disabled={disabled || presentation === "not-set-up"}
          onClick={onCheck}
        >
          Check again
        </Button>
      </MutationGate>
    </>
  );
}

function ConnectionRows({
  connection,
  presentation,
  host,
  disabled,
  act,
}: {
  connection: T3Connection | null;
  presentation: SettingsConnectionPresentation;
  host: boolean;
  disabled: boolean;
  act: (operation: () => Promise<T3Connection>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string>();
  const saved = connection?.endpoint ?? "";
  const editing = host && connection !== null && (draft !== undefined || !saved);
  const endpoint = draft ?? saved;
  const invalid = editing && !!endpoint.trim() && !allowedAddress(endpoint);
  const save = async () => {
    if (await act(() => api.configureConnection({ endpoint }))) setDraft(undefined);
  };
  const contract = connection?.contract;
  return (
    <>
      <SettingsGroup label="Connection">
        <SettingsDetailRow
          label="Address"
          mono={!editing}
          value={
            editing ? (
              <T3AddressForm
                value={endpoint}
                submitLabel="Save"
                invalid={invalid}
                disabled={disabled}
                onChange={setDraft}
                onSave={() => void save()}
              />
            ) : (
              saved || "—"
            )
          }
          action={
            host &&
            !editing && (
              <Button
                variant="outline"
                aria-label="Edit address"
                disabled={disabled}
                onClick={() => setDraft(saved)}
              >
                Edit
              </Button>
            )
          }
        />
        <SettingsDetailRow
          label="T3 Code version"
          value={
            contract ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                {contract.serverName} {contract.serverVersion}
                {presentation === "incompatible" && (
                  <StatusBadge kind="attention">Too old</StatusBadge>
                )}
              </span>
            ) : (
              "—"
            )
          }
        />
        <SettingsDetailRow
          label="Authorization"
          value={authorization(connection, presentation)}
          action={
            host && (
              <AuthorizationAction
                connection={connection}
                presentation={presentation}
                disabled={disabled}
                onAuthorize={() => void act(api.authorizeConnection)}
              />
            )
          }
        />
        <SettingsDetailRow
          label="Last checked"
          value={connection?.checkedAt ? dayAndTime(connection.checkedAt) : "—"}
        />
      </SettingsGroup>
      {editing && <T3AddressHelp invalid={invalid} />}
    </>
  );
}

function AuthorizationAction({
  connection,
  presentation,
  disabled,
  onAuthorize,
}: {
  connection: T3Connection | null;
  presentation: SettingsConnectionPresentation;
  disabled: boolean;
  onAuthorize: () => void;
}) {
  const pending = presentation === "authorization-required" && connection?.authorizationPending;
  const authorized =
    (presentation === "ready" || presentation === "incompatible") &&
    connection?.authorizationContext;
  if (!pending && !authorized) return null;
  return (
    <MutationGate>
      <Button variant="outline" disabled={disabled} onClick={onAuthorize}>
        {pending ? "Start over" : "Reauthorize"}
      </Button>
    </MutationGate>
  );
}

function contractDetails(connection: T3Connection) {
  const { contract } = connection;
  return [
    connection.explanation,
    contract && `Version: ${contract.serverName} ${contract.serverVersion}`,
    contract?.environmentId && `Environment: ${contract.environmentId}`,
    contract && `Tool schemas inspected: ${contract.tools.length}`,
    ...(contract?.problems ?? []),
  ]
    .filter(Boolean)
    .join("\n");
}

function authorization(
  connection: T3Connection | null,
  presentation: SettingsConnectionPresentation,
) {
  if (presentation === "authorization-required")
    return (
      <StatusBadge kind="attention" icon={KeyRound}>
        {connection?.authorizationPending ? "Waiting for approval" : "Not authorized"}
      </StatusBadge>
    );
  if (
    (presentation === "ready" || presentation === "incompatible") &&
    connection?.authorizationContext
  )
    return "Authorized";
  return "—";
}

function ConnectionProblem({
  connection,
  presentation,
  error,
  action,
  retry,
}: {
  connection: T3Connection | null;
  presentation: SettingsConnectionPresentation;
  error: string;
  action: React.ReactNode;
  retry: React.ReactNode;
}) {
  if (presentation === "unavailable")
    return (
      <ProblemCard
        tone="error"
        icon={Unplug}
        title="AgentEasel can’t reach T3 Code"
        action={retry}
        details={connection?.explanation}
      >
        Start T3 Code on the AgentEasel host, then check again. Runs keep going in T3 Code.
      </ProblemCard>
    );
  if (presentation === "authorization-required")
    return connection?.authorizationPending ? (
      <ProblemCard
        tone="attention"
        icon={LoaderCircle}
        title="Approve in the browser on the AgentEasel host"
        action={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {action}
            {retry}
          </div>
        }
      >
        This page updates by itself.
      </ProblemCard>
    ) : (
      <ProblemCard
        tone="attention"
        title="Authorize AgentEasel in T3 Code"
        action={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {action}
            {retry}
          </div>
        }
      >
        T3 Code’s approval page opens in a browser on the AgentEasel host.
      </ProblemCard>
    );
  if (presentation === "incompatible" && connection)
    return (
      <ProblemCard
        tone="attention"
        title="Update T3 Code"
        details={contractDetails(connection)}
        action={retry}
      >
        This T3 Code version is incompatible. Existing Runs keep their history.
      </ProblemCard>
    );
  if (presentation === "load-error")
    return (
      <ProblemCard
        tone="error"
        title="Couldn’t read the connection status"
        details={error}
        action={retry}
      >
        Check that AgentEasel is running, then check again.
      </ProblemCard>
    );
  return null;
}
