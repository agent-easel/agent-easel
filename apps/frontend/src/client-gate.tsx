import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { CircleAlert, Hourglass, KeyRound, ShieldX, WifiOff } from "lucide-react";
import type { ClientAccessState, FactoryClient } from "@agent-easel/contracts";
import {
  FACTORY_MINIMUM_SERVER_PROTOCOL,
  FACTORY_PROTOCOL,
  protocolCompatibility,
} from "@agent-easel/domain-validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Surface } from "@/components/ui/surface";
import { fieldLabelClass } from "@/components/page";
import { GateScreen } from "@/components/gate-screen";
import { api, ApiError } from "./api.ts";
import { ScopeContext, ServerIdContext } from "./client-scope.ts";
import { useRefreshSchedule } from "./refresh-schedule.ts";
import { desktopBridge } from "./desktop-bridge.ts";
import { transport, useLiveDelivery, useTransport } from "./transport.ts";

type Gate =
  | { readonly kind: "checking" }
  | { readonly kind: "unreachable" }
  | { readonly kind: "incompatible"; readonly message: string }
  | { readonly kind: "request"; readonly previous: "none" | "denied" | "revoked" }
  | { readonly kind: "pending"; readonly client: FactoryClient }
  | {
      readonly kind: "ready";
      readonly scope: "host" | "remote";
      readonly serverId: string | null;
    };

const localProtocol = {
  protocol: FACTORY_PROTOCOL,
  minimumPeerProtocol: FACTORY_MINIMUM_SERVER_PROTOCOL,
};

function accessGate(access: ClientAccessState, ready: Extract<Gate, { kind: "ready" }>): Gate {
  if (access.status === "approved") return ready;
  if (access.status === "pending") return { kind: "pending", client: access.client };
  return { kind: "request", previous: access.status };
}

/** Handshake, then the access boundary: product screens mount only for host or approved scope. */
async function evaluate(): Promise<Gate> {
  try {
    const server = await api.getProtocol();
    const compatibility = protocolCompatibility(localProtocol, server);
    if (compatibility.kind !== "compatible")
      return { kind: "incompatible", message: compatibility.message };
    const scope = await api.getClientScope();
    const ready = {
      kind: "ready" as const,
      scope: scope.scope,
      serverId: scope.serverId ?? null,
    };
    return scope.scope === "host" ? ready : accessGate(scope.access, ready);
  } catch (cause) {
    if (cause instanceof ApiError && cause.detail.code === "incompatible")
      return { kind: "incompatible", message: cause.detail.message };
    return { kind: "unreachable" };
  }
}

/**
 * A live socket that cannot open says nothing about why; the handshake does. Incompatible or
 * unapproved results hand the window to this gate, which re-evaluates and shows its screen.
 */
export async function recheckAccess() {
  const gate = await evaluate();
  if (gate.kind === "incompatible") transport.incompatible(gate.message);
  if (gate.kind === "request" || gate.kind === "pending") transport.accessLost();
}

const recheckMs = 2000;

export function ClientGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>({ kind: "checking" });
  const current = useTransport();
  // Keep probing while checking, waiting, unreachable or offline; reconnection refreshes state.
  const probing =
    gate.kind === "pending" ||
    gate.kind === "unreachable" ||
    gate.kind === "checking" ||
    gate.kind === "incompatible" ||
    current.kind === "offline";
  const { refresh: check } = useRefreshSchedule({
    read: evaluate,
    apply: (next: Gate) => {
      // Once ready, an unreachable server is presented as offline over the last observed state.
      setGate((previous) =>
        previous.kind === "ready" && next.kind === "unreachable" ? previous : next,
      );
      if (next.kind !== "unreachable") transport.reset();
    },
    intervalMs: recheckMs,
    watching: probing,
  });
  useEffect(() => {
    if (current.kind === "access-lost" || current.kind === "incompatible") void check();
  }, [current.kind, check]);

  if (gate.kind === "checking") return <ConnectingScreen />;
  if (gate.kind === "unreachable") return <UnreachableScreen />;
  if (gate.kind === "incompatible") return <IncompatibleScreen message={gate.message} />;
  if (gate.kind === "pending") return <PendingScreen client={gate.client} />;
  if (gate.kind === "request")
    return <RequestAccessScreen previous={gate.previous} onRequested={check} />;
  return (
    <ScopeContext.Provider value={gate.scope}>
      <ServerIdContext.Provider value={gate.serverId}>{children}</ServerIdContext.Provider>
    </ScopeContext.Provider>
  );
}

/** Shown while Factory checks whether this window may open the application. */
export function ConnectingScreen() {
  return (
    <GateScreen
      label="Connecting"
      icon={Hourglass}
      title="Connecting to AgentEasel…"
      description="Checking the server's protocol and this device's access."
    />
  );
}

function UnreachableScreen() {
  const desktop = desktopBridge();
  return (
    <GateScreen
      label="AgentEasel unreachable"
      icon={WifiOff}
      title="AgentEasel server unreachable"
      description="This device can’t reach the selected AgentEasel server. It retries automatically; check that the server application is running and the address is reachable on your LAN or tailnet."
    >
      {desktop && (
        <Button variant="secondary" onClick={() => void desktop.forgetServer()}>
          Choose another server
        </Button>
      )}
    </GateScreen>
  );
}

function IncompatibleScreen({ message }: { message: string }) {
  return (
    <GateScreen
      label="Incompatible AgentEasel versions"
      icon={CircleAlert}
      title="This client and server can’t work together"
      description={
        <>
          <p>{message}</p>
          <p className="mt-2">
            No AgentEasel operation is available until the named side is updated.
          </p>
        </>
      }
    />
  );
}

function PendingScreen({ client }: { client: FactoryClient }) {
  return (
    <GateScreen
      label="Waiting for approval"
      icon={Hourglass}
      title="Waiting for approval on the AgentEasel host"
      description="Open AgentEasel on the server computer, go to Settings → Devices & access, and approve this request only if its code matches."
    >
      <Surface tone="inset" className="grid gap-1 p-4 text-center">
        <span className={fieldLabelClass}>Verification code</span>
        <output aria-label="Verification code" className="font-mono text-2xl tracking-widest">
          {client.verificationCode}
        </output>
        <span className="text-xs text-muted-foreground">Requested as “{client.label}”</span>
      </Surface>
    </GateScreen>
  );
}

function defaultLabel() {
  const platform = navigator.userAgent.includes("Mac") ? "Mac" : "computer";
  return desktopBridge() ? `AgentEasel desktop on ${platform}` : `Browser on ${platform}`;
}

const previousCopy: Record<"none" | "denied" | "revoked", { title: string; description: string }> =
  {
    none: {
      title: "Request access to this AgentEasel",
      description:
        "Knowing the address is not enough: the server’s owner approves each device or browser profile on the host.",
    },
    denied: {
      title: "Access was denied",
      description:
        "The AgentEasel host denied this device. You can send a new request if this was a mistake.",
    },
    revoked: {
      title: "Access was revoked",
      description:
        "The AgentEasel host revoked this device. Nothing more can be read or changed from here unless the owner approves a new request.",
    },
  };

function RequestAccessScreen({
  previous,
  onRequested,
}: {
  previous: "none" | "denied" | "revoked";
  onRequested: () => Promise<void>;
}) {
  const current = useTransport();
  const [label, setLabel] = useState(defaultLabel);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    return await api
      .requestClientAccess({
        label,
        kind: desktopBridge() ? "desktop" : "browser",
      })
      .then(() => onRequested())
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "The request could not be sent.");
      })
      .finally(() => {
        setBusy(false);
      });
  };
  const copy = previousCopy[previous];
  return (
    <GateScreen
      label="Request access"
      icon={previous === "none" ? KeyRound : ShieldX}
      title={copy.title}
      description={copy.description}
    >
      <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
        <div className="grid gap-1.5">
          <Label htmlFor="client-label" className={fieldLabelClass}>
            Device name shown to the owner
          </Label>
          <Input
            id="client-label"
            value={label}
            maxLength={80}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || !label.trim() || current.kind === "offline"}>
          {previous === "none" ? "Request access" : "Request access again"}
        </Button>
      </form>
    </GateScreen>
  );
}

export type FactoryConnectionNotice =
  | { readonly kind: "offline"; readonly observedAt: number | null }
  | { readonly kind: "synchronizing" };

/** Usual catch-up takes a moment; announce it only when it is noticeable. */
const synchronizingNoticeDelayMs = 500;

export function useFactoryConnectionNotice(): FactoryConnectionNotice | null {
  const current = useTransport();
  const delivery = useLiveDelivery();
  const offline = current.kind === "offline" || delivery === "offline";
  const synchronizing = !offline && delivery === "synchronizing";
  const [noticeable, setNoticeable] = useState(false);
  useEffect(() => {
    if (!synchronizing) return;
    const timer = setTimeout(() => setNoticeable(true), synchronizingNoticeDelayMs);
    return () => {
      clearTimeout(timer);
      setNoticeable(false);
    };
  }, [synchronizing]);
  if (offline)
    return {
      kind: "offline",
      observedAt:
        current.kind === "online" || current.kind === "offline" ? current.observedAt : null,
    };
  return synchronizing && noticeable ? { kind: "synchronizing" } : null;
}

export function useOfflineReason() {
  return useFactoryConnectionNotice()?.kind === "offline" ? "Offline" : "";
}

/** Product writes wait for every held live scope; local browsing stays available. */
export function useMutationsAllowed() {
  const current = useTransport();
  const delivery = useLiveDelivery();
  return current.kind === "online" && delivery === "current";
}

export function MutationGate({ children }: { children: ReactNode }) {
  const mutationsAllowed = useMutationsAllowed();
  return (
    <fieldset disabled={!mutationsAllowed} className="contents">
      {children}
    </fieldset>
  );
}
