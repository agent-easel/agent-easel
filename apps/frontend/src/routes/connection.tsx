import { MutationGate } from "@/client-gate";
import { useState } from "react";
import type { T3Connection } from "@agent-easel/contracts";
import { KeyRound, LoaderCircle, Unplug } from "lucide-react";
import { useClientScope } from "../client-scope.ts";
import { Button } from "@/components/ui/button";
import { ProblemCard } from "@/components/problem-card";
import { TechnicalDetails } from "@/components/technical-details";
import { SettingsDetailRow, SettingsGroup, SettingsPage } from "@/components/settings-page";
import { StatusBadge } from "@/components/status-badge";
import { dayAndTime } from "../time-format.ts";
import { api } from "../api.ts";
import {
  ConnectionStateBadge,
  useConnectionState,
  settingsConnectionPresentation,
  type SettingsConnectionPresentation,
} from "../connection-state.tsx";
import { allowedAddress, T3AddressForm, T3AddressHelp } from "../components/t3-address.tsx";

export function ConnectionSettingsPanel() {
  const { connection, loadError, presentation: status, setConnection } = useConnectionState();
  const presentation = settingsConnectionPresentation(connection, status);
  const host = useClientScope() === "host";
  const [busy, setBusy] = useState<"checking" | "changing" | null>(null);
  const [operationError, setOperationError] = useState("");
  const disabled = busy !== null || presentation === "loading";
  const primary =
    presentation === "unavailable" ||
    presentation === "incompatible" ||
    presentation === "load-error";
  const pending = presentation === "authorization-required" && connection?.authorizationPending;
  const act = async (
    operation: () => Promise<T3Connection>,
    phase: "checking" | "changing" = "changing",
  ) => {
    setBusy(phase);
    setOperationError("");
    return await operation()
      .then(
        (value) => {
          setConnection(value);
          return true;
        },
        (cause: unknown) => {
          setOperationError(String(cause));
          return false;
        },
      )
      .finally(() => setBusy(null));
  };
  return (
    <SettingsPage
      title="T3 Code connection"
      badge={<ConnectionStateBadge presentation={busy === "checking" ? "loading" : presentation} />}
      hostManaged={!host}
      action={
        <MutationGate>
          <Button
            variant={primary ? "default" : "outline"}
            disabled={disabled || presentation === "not-set-up"}
            onClick={() => void act(api.recheckConnection, "checking")}
          >
            Check again
          </Button>
        </MutationGate>
      }
    >
      <ConnectionProblem
        connection={connection}
        presentation={presentation}
        error={loadError}
        action={
          <MutationGate>
            <Button
              variant={pending ? "outline" : "default"}
              disabled={disabled}
              onClick={() =>
                void act(
                  host && !pending ? api.authorizeConnection : api.openConnectionAuthorization,
                )
              }
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
}: {
  connection: T3Connection | null;
  presentation: SettingsConnectionPresentation;
  error: string;
  action: React.ReactNode;
}) {
  if (presentation === "unavailable")
    return (
      <ProblemCard
        tone="error"
        icon={Unplug}
        title="AgentEasel can’t reach T3 Code"
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
        action={action}
      >
        This page updates by itself.
      </ProblemCard>
    ) : (
      <ProblemCard tone="attention" title="Authorize AgentEasel in T3 Code" action={action}>
        T3 Code’s approval page opens in a browser on the AgentEasel host.
      </ProblemCard>
    );
  if (presentation === "incompatible" && connection)
    return (
      <ProblemCard tone="attention" title="Update T3 Code" details={contractDetails(connection)}>
        This T3 Code version is incompatible. Existing Runs keep their history.
      </ProblemCard>
    );
  if (presentation === "load-error")
    return (
      <ProblemCard tone="error" title="Couldn’t read the connection status" details={error}>
        Check that AgentEasel is running, then check again.
      </ProblemCard>
    );
  return null;
}
