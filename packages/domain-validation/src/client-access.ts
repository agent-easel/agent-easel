import type {
  ClientKind,
  ProtocolCompatibility,
  ProtocolDescriptor,
  RequestClientAccessInput,
  Result,
} from "@t3-factory/contracts";

/**
 * Factory client/server wire protocol. Raise `FACTORY_PROTOCOL` for any change a
 * peer must understand; raise the minimum only when older peers can no longer
 * interoperate safely. Application release numbers never decide compatibility.
 */
export const FACTORY_PROTOCOL = 20;
/** Protocol 20 adds the First-run setup status and completion. A client opens the application only
 * once the host's setup is completed, which older clients do not check, so they must update.
 * Protocol 19 adds Agent Create reservations. Older clients still create without a reservation.
 * Protocol 18 adds the Trigger operations, Studio's Trigger list and the Run origin, which
 * protocol 17 clients ignore. Protocol 17 Flows and Agents have an owning Project and Flow
 * validation is per Flow, naming each placed Agent's revision and owner, which older clients can
 * neither send nor compare. Protocol 16 Flows and Runs may contain Condition blocks with their
 * rules and outputs. Protocol 15 adds attention fields and the Run-level `settlement-unresolved`
 * kind, whose Block id is null. Protocol 14 theme-color presentations and sources carry no
 * appearance grant. */
export const FACTORY_MINIMUM_PEER_PROTOCOL = 20;
/** The current UI reads the host's First-run setup status before it opens the application. */
export const FACTORY_MINIMUM_SERVER_PROTOCOL = 20;

export const CLIENT_LABEL_LIMIT = 80;

/** Decides, before product operations, which side of an unsupported pair must update. */
export function protocolCompatibility(
  client: Pick<ProtocolDescriptor, "protocol" | "minimumPeerProtocol">,
  server: Pick<ProtocolDescriptor, "protocol" | "minimumPeerProtocol">,
): ProtocolCompatibility {
  if (client.protocol < server.minimumPeerProtocol)
    return {
      kind: "update-client",
      message: `This client speaks Factory protocol ${client.protocol}; the server requires at least ${server.minimumPeerProtocol}. Update this client.`,
    };
  if (server.protocol < client.minimumPeerProtocol)
    return {
      kind: "update-server",
      message: `The server speaks Factory protocol ${server.protocol}; this client requires at least ${client.minimumPeerProtocol}. Update the Factory server on its host.`,
    };
  return { kind: "compatible" };
}

const clientKinds: readonly ClientKind[] = ["desktop", "browser"];

/** A label only helps the owner recognize a request; it never grants access. */
export function validateClientAccessRequest(input: unknown): Result<RequestClientAccessInput> {
  const record = typeof input === "object" && input !== null ? input : {};
  const label = "label" in record && typeof record.label === "string" ? record.label.trim() : "";
  const kind = "kind" in record ? record.kind : undefined;
  const control = Array.from({ length: label.length }, (_, index) => label.charCodeAt(index)).some(
    (code) => code < 0x20,
  );
  if (label.length === 0 || label.length > CLIENT_LABEL_LIMIT || control)
    return {
      ok: false,
      error: {
        code: "validation",
        message: `Name this device in 1–${CLIENT_LABEL_LIMIT} characters.`,
        issues: [
          {
            code: "invalid_label",
            path: "label",
            message: `Name this device in 1–${CLIENT_LABEL_LIMIT} characters.`,
          },
        ],
      },
    };
  if (!clientKinds.includes(kind as ClientKind))
    return {
      ok: false,
      error: {
        code: "validation",
        message: "Client kind must be desktop or browser.",
        issues: [
          {
            code: "invalid_kind",
            path: "kind",
            message: "Client kind must be desktop or browser.",
          },
        ],
      },
    };
  return { ok: true, value: { label, kind: kind as ClientKind } };
}
