import type { T3ToolAnswer } from "./connection.ts";
import type { WorkerTitleRenameDisposition, WorkerTitleRenameRequest } from "./threads.ts";

const CAPABILITY_DENIAL = ["missing orchestration capability", "read-only approval"];

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function codedFailure(value: unknown) {
  const body = record(value);
  if (!body || typeof body.code !== "string") return undefined;
  return {
    code: body.code,
    message: typeof body.message === "string" ? body.message : undefined,
  };
}

function capabilityDenied(message: string | undefined) {
  return !!message && CAPABILITY_DENIAL.some((phrase) => message.includes(phrase));
}

function successDisposition(
  request: WorkerTitleRenameRequest,
  content: unknown,
): WorkerTitleRenameDisposition {
  const body = record(content);
  if (
    !body ||
    body.threadId !== request.threadId ||
    body.action !== "rename" ||
    typeof body.title !== "string"
  )
    return { kind: "unclassified" };
  return body.title === request.title
    ? { kind: "acknowledged", threadId: request.threadId, title: body.title }
    : { kind: "different-title", threadId: request.threadId, title: body.title };
}

export function workerTitleRenameDisposition(
  request: WorkerTitleRenameRequest,
  answer: T3ToolAnswer,
): WorkerTitleRenameDisposition {
  if (!answer.isError) return successDisposition(request, answer.content);
  const text = answer.text ?? (typeof answer.content === "string" ? answer.content : undefined);
  const coded = codedFailure(answer.content);
  if (
    coded?.code === "thread_not_found" ||
    text?.startsWith(`Thread ${request.threadId} was not found.`)
  )
    return { kind: "thread-not-found" };
  if (
    coded?.code === "capability_denied" ||
    capabilityDenied(text) ||
    capabilityDenied(coded?.message)
  )
    return { kind: "capability-denied" };
  return { kind: "unclassified" };
}
