import { MutationGate } from "@/client-gate";
import { useState } from "react";
import type { T3Connection } from "@t3-factory/contracts";
import { KeyRound, LoaderCircle, Unplug } from "lucide-react";
import { useClientScope } from "../client-scope.ts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      title="T3 connection"
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
          title="Couldn’t change the T3 connection"
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
              <AddressForm
                value={endpoint}
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
          label="T3 version"
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
      {invalid && (
        <ProblemCard tone="error" title="Use HTTPS, or HTTP on this computer">
          Leave credentials, queries and fragments out of the address.
        </ProblemCard>
      )}
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

function AddressForm({
  value,
  invalid,
  disabled,
  onChange,
  onSave,
}: {
  value: string;
  invalid: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const blocked = disabled || invalid || !value.trim();
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!blocked) onSave();
      }}
    >
      <Input
        type="url"
        aria-label="Address"
        aria-invalid={invalid}
        disabled={disabled}
        value={value}
        placeholder="http://127.0.0.1:3773/mcp"
        className="min-w-28 flex-1 bg-muted font-mono text-label"
        onChange={(event) => onChange(event.target.value)}
      />
      {invalid && <StatusBadge kind="error">Not allowed</StatusBadge>}
      <MutationGate>
        <Button type="submit" disabled={blocked}>
          Save
        </Button>
      </MutationGate>
    </form>
  );
}

function allowedAddress(value: string) {
  const url = URL.parse(value.trim());
  return (
    !!url &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    (url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
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
        title="Factory can’t reach T3"
        details={connection?.explanation}
      >
        Start T3 on the Factory host, then check again. Runs keep going in T3.
      </ProblemCard>
    );
  if (presentation === "authorization-required")
    return connection?.authorizationPending ? (
      <ProblemCard
        tone="attention"
        icon={LoaderCircle}
        title="Approve in the browser on the Factory host"
        action={action}
      >
        This page updates by itself.
      </ProblemCard>
    ) : (
      <ProblemCard tone="attention" title="Authorize Factory in T3" action={action}>
        T3’s approval page opens in a browser on the Factory host.
      </ProblemCard>
    );
  if (presentation === "incompatible" && connection)
    return (
      <ProblemCard tone="attention" title="Update T3" details={contractDetails(connection)}>
        This T3 version is incompatible. Existing Runs keep their history.
      </ProblemCard>
    );
  if (presentation === "load-error")
    return (
      <ProblemCard tone="error" title="Couldn’t read the connection status" details={error}>
        Check that Factory is running, then check again.
      </ProblemCard>
    );
  return null;
}
