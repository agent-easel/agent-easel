import type { ProtocolCompatibility, ProtocolDescriptor } from "@agent-easel/contracts";
import { protocolCompatibility } from "@agent-easel/domain-validation";

/** Browser profiles hold their credential only in this HttpOnly cookie, never in script. */
const credentialCookieName = "factory_client";
const credentialLifetimeSeconds = 400 * 24 * 3600;

type Headers = Readonly<Record<string, string | undefined>>;

/** Desktop clients send a bearer credential; browsers send the cookie set at request time. */
export function requestCredential(headers: Headers): string | undefined {
  const bearer = /^Bearer ([^\s]+)$/.exec(headers.authorization ?? "")?.[1];
  if (bearer) return bearer;
  for (const part of (headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === credentialCookieName) return value.join("=") || undefined;
  }
  return undefined;
}

export const credentialCookie = (credential: string) =>
  `${credentialCookieName}=${credential}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${credentialLifetimeSeconds}`;

/**
 * The client's declared protocol, checked before any product operation. `undefined`
 * means the request declared none.
 */
export function declaredProtocolCompatibility(
  headers: Headers,
  server: ProtocolDescriptor,
): ProtocolCompatibility | undefined {
  const protocol = headers["x-factory-protocol"];
  if (protocol === undefined) return undefined;
  const minimum = headers["x-factory-protocol-minimum"] ?? protocol;
  if (!/^\d{1,6}$/.test(protocol) || !/^\d{1,6}$/.test(minimum))
    return {
      kind: "update-client",
      message: "This client sent an unreadable AgentEasel protocol. Update this client.",
    };
  return protocolCompatibility(
    { protocol: Number(protocol), minimumPeerProtocol: Number(minimum) },
    server,
  );
}

/** Bounds unauthenticated access requests per peer; approval itself is never automatic. */
export class RequestLimiter {
  private readonly attempts = new Map<string, number[]>();
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private readonly limit: number;
  private readonly windowMs: number;
  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }
  allow(key: string, at = Date.now()): boolean {
    if (this.closed) return false;
    const recent = (this.attempts.get(key) ?? []).filter((time) => at - time < this.windowMs);
    if (recent.length >= this.limit) return false;
    this.attempts.set(key, [...recent, at]);
    this.expiry ??= setTimeout(this.expire, this.windowMs).unref();
    return true;
  }

  private readonly expire = () => {
    const cutoff = Date.now() - this.windowMs;
    for (const [peer, attempts] of this.attempts)
      if (!attempts.some((time) => time > cutoff)) this.attempts.delete(peer);
    this.expiry = this.attempts.size ? setTimeout(this.expire, this.windowMs).unref() : undefined;
  };

  close() {
    this.closed = true;
    clearTimeout(this.expiry);
    this.expiry = undefined;
    this.attempts.clear();
  }
}
