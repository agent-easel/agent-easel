import { clientAccessServerOperations, operationPath } from "@t3-factory/contracts";
import { MutationGate } from "@/client-gate";
import { createContext, useContext, useState, type ReactNode } from "react";
import type { ClientAccessStatus, FactoryClient, RemoteAccessStatus } from "@t3-factory/contracts";
import { CircleX, KeyRound, type LucideIcon } from "lucide-react";
import { dayAndTime } from "./execution-state.tsx";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { api } from "../api.ts";
import { useRefreshSchedule } from "../refresh-schedule.ts";
import {
  SettingsDetailRow,
  SettingsProblemCard,
  SettingsGroup,
  SettingsPage,
  SettingsRow,
} from "./settings-page.tsx";
import { StatusBadge, type SettingKind } from "./status-badge.tsx";

type Decision = "approve" | "deny" | "revoke";

interface DeviceAccess {
  remote: RemoteAccessStatus | null;
  clients: readonly FactoryClient[];
  error: string;
  busy: boolean;
  setRemoteAccess: (enabled: boolean) => void;
  decide: (id: string, decision: Decision) => void;
}

const DeviceAccessContext = createContext<DeviceAccess | null>(null);

const decisionOperations = {
  approve: "approveClient",
  deny: "denyClient",
  revoke: "revokeClient",
} as const satisfies Record<Decision, keyof typeof api>;

/**
 * Host-only: remote access and the device list, read once for Settings so the Devices & access
 * page and its navigation marker show the same requests.
 */
export function DeviceAccessProvider({ children }: { children: ReactNode }) {
  const [remote, setRemote] = useState<RemoteAccessStatus | null>(null);
  const [clients, setClients] = useState<readonly FactoryClient[]>([]);
  const [actionError, setActionError] = useState<{
    kind: "listener" | "device";
    details: string;
  }>();
  const [busy, setBusy] = useState(false);
  const { failure, refresh } = useRefreshSchedule({
    read: () => Promise.all([api.getRemoteAccess(), api.listClients()]),
    apply: ([status, list]) => {
      setRemote(status);
      setClients(list);
    },
    intervalMs: 2000,
  });
  const readError = !failure
    ? ""
    : failure.cause instanceof Error
      ? failure.cause.message
      : "Access status unavailable.";
  const act = async (kind: "listener" | "device", operation: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(undefined);
    return await operation()
      .then(
        () => refresh(),
        async (cause: unknown) => {
          // Starting the listener can update its persisted status even when the request fails.
          await refresh();
          setActionError({ kind, details: String(cause) });
        },
      )
      .finally(() => {
        setBusy(false);
      });
  };
  const error =
    actionError?.kind === "listener" && remote?.problem
      ? readError
      : (actionError?.details ?? readError);
  const access: DeviceAccess = {
    remote,
    clients,
    error,
    busy,
    setRemoteAccess: (enabled) => void act("listener", () => api.setRemoteAccess({ enabled })),
    decide: (id, decision) => void act("device", () => api[decisionOperations[decision]](id)),
  };
  return <DeviceAccessContext.Provider value={access}>{children}</DeviceAccessContext.Provider>;
}

/** Devices waiting for the owner's approval; none outside the host's provider. */
export function usePendingDeviceCount() {
  const access = useContext(DeviceAccessContext);
  return access?.clients.filter((client) => client.status === "pending").length ?? 0;
}

function useDeviceAccess() {
  const access = useContext(DeviceAccessContext);
  if (!access) throw new Error("Devices & access is rendered only inside DeviceAccessProvider.");
  return access;
}

/** Host-only: secure remote access and the owner's approvals. Remote clients never see it. */
export function AccessSettings() {
  const { remote, clients, error, busy, setRemoteAccess, decide } = useDeviceAccess();
  return (
    <SettingsPage title="Devices & access">
      {error && (
        <SettingsProblemCard
          tone="error"
          title="Couldn’t update devices and access"
          details={error}
        />
      )}
      <RemoteAccessGroup remote={remote} busy={busy} onToggle={setRemoteAccess} />
      <DeviceList clients={clients} busy={busy} onDecide={decide} />
    </SettingsPage>
  );
}

function RemoteAccessGroup({
  remote,
  busy,
  onToggle,
}: {
  remote: RemoteAccessStatus | null;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const fingerprint = remote?.enabled && !remote.problem ? remote.certificateFingerprint : null;
  const addresses = remote?.enabled && !remote.problem ? remote.addresses : [];
  return (
    <>
      <SettingsGroup label="Remote access">
        <SettingsRow
          title={
            <span className="flex flex-wrap items-center gap-2">
              Allow approved devices on my LAN or tailnet
              {remote?.problem && (
                <StatusBadge kind="error" aria-hidden>
                  Couldn’t start
                </StatusBadge>
              )}
            </span>
          }
          control={(text) => (
            <MutationGate>
              <Switch
                aria-labelledby={text.title}
                checked={remote?.enabled ?? false}
                disabled={busy || remote === null}
                onCheckedChange={onToggle}
              />
            </MutationGate>
          )}
        />
        {addresses.map((address, index) => (
          <SettingsDetailRow
            key={address}
            label={addresses.length === 1 ? "Address" : `Address ${index + 1}`}
            value={address}
            mono
            copy={address}
          />
        ))}
        {fingerprint && (
          <SettingsDetailRow
            label={remote?.certificateSource === "factory" ? "CA fingerprint" : "Fingerprint"}
            value={
              <span className="wrap-normal">
                {fingerprint.split(":").map((part, index) => (
                  <span key={index}>
                    {index > 0 && (
                      <>
                        <span>:</span>
                        <wbr />
                      </>
                    )}
                    {part}
                  </span>
                ))}
              </span>
            }
            mono
            copy={fingerprint}
          />
        )}
        {fingerprint && remote?.addresses[0] && (
          <SettingsDetailRow
            label="Desktop link"
            value={<DesktopLink address={remote.addresses[0]} fingerprint={fingerprint} />}
            mono
            copy={desktopLink(remote.addresses[0], fingerprint)}
          />
        )}
        {fingerprint && (
          <SettingsRow
            title="Browser certificate"
            control={
              <Button variant="outline" asChild>
                <a
                  href={operationPath(clientAccessServerOperations.getRemoteAccessCertificate)}
                  download="t3-factory-host.pem"
                  aria-label="Download certificate"
                >
                  Download
                </a>
              </Button>
            }
          />
        )}
      </SettingsGroup>
      {remote?.problem && (
        <SettingsProblemCard
          tone="error"
          title="Remote access couldn’t start"
          details={remote.problem}
        >
          Check the network and certificate settings, then turn remote access off and on.
        </SettingsProblemCard>
      )}
    </>
  );
}

/** The address with the certificate pin a desktop client verifies without asking. */
const desktopLink = (address: string, fingerprint: string) =>
  `${address}#sha256=${fingerprint.replaceAll(":", "")}`;

function DesktopLink({ address, fingerprint }: { address: string; fingerprint: string }) {
  const link = desktopLink(address, fingerprint);
  return (
    <span className="flex whitespace-nowrap">
      <span className="truncate">{link.slice(0, address.length + 16)}…</span>
      <span className="shrink-0">{link.slice(-8)}</span>
    </span>
  );
}

const deviceStatus = {
  pending: { kind: "attention", label: "Waiting", icon: KeyRound },
  approved: { kind: "success", label: "Approved" },
  denied: { kind: "neutral", label: "Denied", icon: CircleX },
  revoked: { kind: "neutral", label: "Revoked", icon: CircleX },
} as const satisfies Record<
  ClientAccessStatus,
  { kind: SettingKind; label: string; icon?: LucideIcon }
>;

function deviceTime(client: FactoryClient) {
  if (client.status === "revoked" && client.decidedAt)
    return ` · revoked ${dayAndTime(client.decidedAt)}`;
  if (client.status === "denied" && client.decidedAt)
    return ` · denied ${dayAndTime(client.decidedAt)}`;
  return client.lastSeenAt ? ` · last seen ${dayAndTime(client.lastSeenAt)}` : "";
}

/** Requests waiting for the owner come first, then devices that can still be revoked. */
const listOrder: Record<ClientAccessStatus, number> = {
  pending: 0,
  approved: 1,
  denied: 2,
  revoked: 2,
};

function DeviceList({
  clients,
  busy,
  onDecide,
}: {
  clients: readonly FactoryClient[];
  busy: boolean;
  onDecide: (id: string, decision: Decision) => void;
}) {
  const [revoking, setRevoking] = useState<FactoryClient | null>(null);
  const ordered = clients.toSorted((a, b) => listOrder[a.status] - listOrder[b.status]);
  return (
    <SettingsGroup label="Devices">
      {ordered.length === 0 && <SettingsRow description="No devices yet" />}
      {ordered.map((client) => {
        const status = deviceStatus[client.status];
        return (
          <div key={client.id} role="group" aria-label={`${client.label}, ${status.label}`}>
            <SettingsRow
              title={
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{client.label}</span>
                  <StatusBadge
                    kind={status.kind}
                    {...("icon" in status ? { icon: status.icon } : {})}
                  >
                    {status.label}
                  </StatusBadge>
                </span>
              }
              description={
                <>
                  {client.kind === "browser" ? "Browser" : "Desktop app"}
                  {client.status === "pending" ? (
                    <>
                      {" "}
                      · code{" "}
                      <span className="font-mono">
                        {client.verificationCode.replace(/^(\d{3})(\d{3})$/, "$1 $2")}
                      </span>
                    </>
                  ) : (
                    deviceTime(client)
                  )}
                </>
              }
              control={
                client.status === "pending" ? (
                  <MutationGate>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => onDecide(client.id, "deny")}
                    >
                      Deny
                    </Button>
                    <Button disabled={busy} onClick={() => onDecide(client.id, "approve")}>
                      Approve
                    </Button>
                  </MutationGate>
                ) : client.status === "approved" ? (
                  <MutationGate>
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() => setRevoking(client)}
                    >
                      Revoke…
                    </Button>
                  </MutationGate>
                ) : undefined
              }
            />
          </div>
        );
      })}
      {revoking && (
        <Dialog open onOpenChange={(open) => !open && setRevoking(null)}>
          <DialogContent
            title={<>Revoke “{revoking.label}”?</>}
            description="It loses access now, including open windows."
            actions={
              <>
                <Button variant="outline" onClick={() => setRevoking(null)}>
                  Cancel
                </Button>
                <MutationGate>
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() => {
                      onDecide(revoking.id, "revoke");
                      setRevoking(null);
                    }}
                  >
                    Revoke
                  </Button>
                </MutationGate>
              </>
            }
          />
        </Dialog>
      )}
    </SettingsGroup>
  );
}
