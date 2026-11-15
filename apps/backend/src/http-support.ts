import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import { HttpServerResponse } from "effect/http";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import { isHttpServerError } from "effect/http/HttpServerError";
import type { HttpServerRequest as HttpServerRequestType } from "effect/http/HttpServerRequest";
import type { Result } from "@t3-factory/contracts";
import {
  DEFINITION_REQUEST_LIMIT_BYTES,
  PORTABLE_DOCUMENT_LIMIT_BYTES,
} from "@t3-factory/domain-validation";
import { failure } from "./result.ts";

const jsonResultHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
} as const;

export function resultResponse(
  result: Result<unknown>,
  successStatus = 200,
): HttpServerResponse.HttpServerResponse {
  const status = result.ok
    ? successStatus
    : {
        validation: 400,
        unauthorized: 401,
        host_only: 403,
        not_found: 404,
        conflict: 409,
        missing_images: 409,
        too_large: 413,
        incompatible: 426,
        internal: 500,
      }[result.error.code];
  return HttpServerResponse.jsonUnsafe(result, { status, headers: jsonResultHeaders });
}

export function sendFaviconResponse(
  result: Result<{ contentType: string; data: Uint8Array }>,
): HttpServerResponse.HttpServerResponse {
  if (!result.ok) return resultResponse(result);
  return HttpServerResponse.uint8Array(Buffer.from(result.value.data), {
    status: 200,
    contentType: result.value.contentType,
    headers: { "cache-control": "private, no-cache" },
  });
}

export interface JsonBodyLimit {
  readonly bytes: number;
  readonly message: string;
  /** When set, a body over `bytes` answers 413 `too_large` with this message. */
  readonly tooLarge?: string;
  /** When set, a body whose read failed for another reason answers with this message. */
  readonly unreadable?: string;
}
export const standardBody: JsonBodyLimit = {
  bytes: 16_384,
  message: "Send valid JSON up to 16 KiB with application/json.",
};
export const definitionBody: JsonBodyLimit = {
  bytes: DEFINITION_REQUEST_LIMIT_BYTES,
  message: "Send valid JSON up to 2 MB with application/json.",
};
/** Import review and commit: a portable document up to the import limit. */
export const importBody: JsonBodyLimit = {
  bytes: PORTABLE_DOCUMENT_LIMIT_BYTES,
  message: "Send valid JSON up to 16 MiB with application/json.",
  tooLarge: "This file is larger than the 16 MiB an import accepts.",
  unreadable: "The file did not arrive completely. Try the import again.",
};

/** Only a body over the read limit counts as too large; any other failed read is unreadable. */
const bodyTooLarge = (error: unknown) =>
  isHttpServerError(error) &&
  error.reason._tag === "RequestParseError" &&
  error.reason.reason === "BodyTooLarge";

function unreadableBody(limit: JsonBodyLimit, tooLarge: boolean) {
  if (tooLarge && limit.tooLarge)
    return resultResponse(
      failure("too_large", limit.tooLarge, [
        { code: "document_too_large", path: "document", message: limit.tooLarge },
      ]),
    );
  if (limit.unreadable)
    return resultResponse(
      failure("validation", limit.unreadable, [
        { code: "document_unreadable", path: "document", message: limit.unreadable },
      ]),
    );
  return resultResponse(failure("validation", limit.message));
}

/** Reads a body within `limit`, answering a failed read with the response its cause deserves. */
function boundedRead<A, E>(read: Effect.Effect<A, E>, limit: JsonBodyLimit) {
  return read.pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.fromInputUnsafe(limit.bytes)),
    Effect.map((value) => ({ kind: "ok" as const, value })),
    Effect.catch((error) =>
      Effect.succeed({
        kind: "invalid" as const,
        response: unreadableBody(limit, bodyTooLarge(error)),
      }),
    ),
    Effect.catchCause(() =>
      Effect.succeed({ kind: "invalid" as const, response: unreadableBody(limit, false) }),
    ),
  );
}

/** Keep malformed-body handling at the transport boundary, including JSON null. */
export function readJsonBody(
  request: HttpServerRequestType,
  limit: JsonBodyLimit,
): Effect.Effect<
  | { readonly kind: "ok"; readonly value: unknown }
  | { readonly kind: "invalid"; readonly response: HttpServerResponse.HttpServerResponse }
> {
  return Effect.gen(function* () {
    const contentType = request.headers["content-type"]?.toLowerCase() ?? "";
    if (!contentType.startsWith("application/json")) {
      return {
        kind: "invalid" as const,
        response: resultResponse(failure("validation", limit.message)),
      };
    }
    const body = yield* boundedRead(request.text, limit);
    if (body.kind === "invalid") return body;
    try {
      return { kind: "ok" as const, value: JSON.parse(body.value) };
    } catch {
      return {
        kind: "invalid" as const,
        response: resultResponse(failure("validation", limit.message)),
      };
    }
  });
}

/** Raw JSON writer for transport rejections and runtime replies, which are not Factory Results. */
export function writeJsonResponse(
  status: number,
  body: unknown,
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe(body, {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** A raw request body up to `bytes`, passed to the route with its declared Content-Type. */
export function readRawBody(
  request: HttpServerRequestType,
  limit: JsonBodyLimit,
): Effect.Effect<
  | { readonly kind: "ok"; readonly value: { mimeType: string; data: Uint8Array } }
  | { readonly kind: "invalid"; readonly response: HttpServerResponse.HttpServerResponse }
> {
  return Effect.gen(function* () {
    const body = yield* boundedRead(request.arrayBuffer, limit);
    if (body.kind === "invalid") return body;
    const mimeType = (request.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    return { kind: "ok" as const, value: { mimeType, data: new Uint8Array(body.value) } };
  });
}

/** Whether an `If-None-Match` header names this entity tag (weak or strong) or any (`*`). */
function matchesEntityTag(ifNoneMatch: string | undefined, tag: string) {
  return (ifNoneMatch ?? "")
    .split(",")
    .map((candidate) => candidate.trim().replace(/^W\//, ""))
    .some((candidate) => candidate === tag || candidate === "*");
}

/**
 * A digest's bytes never change but can be deleted, so caches revalidate every load: an intact
 * image answers 304 to its own tag, and a deleted one answers not found instead of a cached copy.
 */
export function runImageResponse(
  sha256: string,
  ifNoneMatch: string | undefined,
  result: Result<{ mimeType: string; data: Uint8Array }>,
): HttpServerResponse.HttpServerResponse {
  if (!result.ok) return resultResponse(result);
  const headers = { "cache-control": "private, no-cache", etag: `"${sha256}"` };
  if (matchesEntityTag(ifNoneMatch, headers.etag))
    return HttpServerResponse.empty({ status: 304, headers });
  return HttpServerResponse.uint8Array(result.value.data, {
    status: 200,
    contentType: result.value.mimeType,
    headers,
  });
}

export interface OperationCall {
  /** Parsed JSON body; undefined for routes that take none. */
  readonly input: unknown;
  readonly url: URL;
  readonly method: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  /** Socket peer address, used only to bound unauthenticated access requests. */
  readonly peer: string;
}

/** Who may call a route: admission decisions the server alone enforces. */
export interface RouteTrust {
  /** Route exists only on that listener; the other answers 404. */
  readonly surface?: "host" | "remote";
  /** The protocol handshake itself: answered before a client declares its protocol. */
  readonly handshake?: true;
  /** Browser image GET/HEAD requests cannot set protocol headers; credentials still apply. */
  readonly protocolOptional?: true;
  /** Reachable on the approved-client listener without an approved credential. */
  readonly public?: true;
  /** Host setup that changes the host's T3, reporting or installation-wide settings; remote
   * clients get `host_only`. */
  readonly hostOnly?: true;
}
