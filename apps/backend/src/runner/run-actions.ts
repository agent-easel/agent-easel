import type {
  Result,
  RunDetail,
  RunSettlementOutcome,
  SettleRunInput,
  TaskSummary,
} from "@t3-factory/contracts";
import { TASK_TITLE_LIMIT } from "@t3-factory/domain-validation";
import * as Effect from "effect/Effect";
import type { T3Threads } from "../t3/threads.ts";
import type { ContractSnapshots } from "../connection.ts";
import { failure } from "../result.ts";
import type { RuntimeReply, RuntimeReport } from "../runtime-types.ts";
import type { RunStore, WaitForwarding } from "./run-store/run-store.ts";
import type { OwnedThreads } from "./owned-thread.ts";
import { recoverOperation } from "./runner-effects.ts";
import { recoveryReady } from "./runner-recovery.ts";
import type { RunnerSettlement } from "./runner-settle.ts";
import { runTarget, type RunnerLifecycle } from "./runner-types.ts";
import { fingerprint } from "../fingerprint.ts";
import { now } from "../time.ts";

/** Why Continue now changed nothing. */
const waitRefusals: Record<Exclude<WaitForwarding, "forwarded">, Result<never>> = {
  "not-found": failure("not_found", "This Wait arrival does not exist."),
  "already-forwarded": failure("conflict", "This Wait arrival was already forwarded."),
  cancelled: failure(
    "conflict",
    "This Wait arrival was cancelled when its Run was archived or settled manually.",
  ),
  closed: failure(
    "conflict",
    "This Run is archived, stopping its workers to settle, or no longer run by this Factory, so it forwards no Wait arrival.",
  ),
};

/** What lets Factory stop a Run's executing workers to settle it: the user's confirmation of
 * Settle, or the Flow itself when the Run reached an ending (no dialog). The reason it records
 * follows from who authorized it. */
export type StopAndSettle =
  | { readonly authorization: "user-confirmed"; readonly reason: "manual" }
  | { readonly authorization: "flow"; readonly reason: "finish" };

/** A plain object whose only allowed field is an optional boolean `stopWorkers`: a misspelled or
 * misplaced authorization flag is a validation error, never a declined Settle. */
function validSettleInput(input: unknown): input is SettleRunInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const { stopWorkers, ...rest } = input as Record<string, unknown>;
  return (
    !Object.keys(rest).length && (stopWorkers === undefined || typeof stopWorkers === "boolean")
  );
}

/**
 * The user actions on a Run. Each refuses while Factory closes, validates its untrusted input,
 * decides and records its change through one Run store transition, then forks or runs its
 * follow-up dispatch or T3 effect, so a request never waits for background work unless stated.
 */
export function openRunActions({
  store,
  t3,
  ownedThreads,
  lifecycle,
  freshSnapshot,
  cancelWaitTimer,
  settlement,
  reconcileTitleGeneration,
}: {
  store: RunStore;
  t3: T3Threads;
  ownedThreads: OwnedThreads;
  lifecycle: RunnerLifecycle;
  freshSnapshot: ContractSnapshots["fresh"];
  cancelWaitTimer: (arrivalId: string) => Effect.Effect<void>;
  settlement: RunnerSettlement;
  reconcileTitleGeneration: (runId: string) => Effect.Effect<void, unknown>;
}) {
  const { isClosed, drive, fork, getRun } = lifecycle;

  /** Runs `action` only while Factory is open; the check runs when the action runs. */
  function whenOpen<A>(
    action: Effect.Effect<Result<A>, unknown>,
  ): Effect.Effect<Result<A>, unknown> {
    return Effect.suspend(() =>
      isClosed() ? Effect.succeed(failure("conflict", "Factory is shutting down.")) : action,
    );
  }

  /** `requestId`, when a caller supplies one, attributes the applied answer to that request. */
  function answerHumanOccurrence(
    id: string,
    input: unknown,
    requestId?: string,
  ): Effect.Effect<Result<RunDetail>, unknown> {
    return whenOpen(
      Effect.gen(function* () {
        if (!input || typeof input !== "object" || Array.isArray(input))
          return failure("validation", "Send an answer object.");
        const { exitId, message } = input as {
          exitId?: unknown;
          message?: unknown;
        };
        if (
          (exitId !== undefined && typeof exitId !== "string") ||
          (message !== undefined && (typeof message !== "string" || message.length > 100000))
        )
          return failure("validation", "Choose an exit and use text up to 100,000 characters.");
        const answered = yield* store.answerHumanOccurrence(id, { exitId, message, requestId });
        if (!answered.ok) return answered;
        const detail = yield* getRun(answered.value.runId);
        if (!isClosed()) yield* fork(drive(answered.value.runId, "dispatch"));
        return detail;
      }),
    );
  }

  /** Continue now: forwards arrival `id` through the same guarded transition as its timer,
   * disables the timer and dispatches the new Handoffs. */
  function continueWaitArrival(id: string): Effect.Effect<Result<RunDetail>, unknown> {
    return whenOpen(
      Effect.gen(function* () {
        if (!id.trim() || id.length > 200) return failure("validation", "Choose a Wait arrival.");
        const runId = yield* store.waitArrivalRunId(id);
        if (!runId) return waitRefusals["not-found"];
        const outcome = yield* store.forwardWaitArrival(runId, id, "user");
        if (outcome !== "forwarded") return waitRefusals[outcome];
        yield* cancelWaitTimer(id);
        const detail = yield* getRun(runId);
        yield* fork(drive(runId, "dispatch"));
        return detail;
      }),
    );
  }

  /** A Block's worker reports through Factory MCP, which expects `RUNNER_UNAVAILABLE` while
   * Factory closes. */
  function consumeBlockUpdate(publicId: string, report: RuntimeReport) {
    if (isClosed()) return Effect.succeed<RuntimeReply>({ code: "RUNNER_UNAVAILABLE" });
    return Effect.gen(function* () {
      const located = yield* store.locateBlock(publicId);
      if (!located) return { code: "UNKNOWN_BLOCK" };
      // The report belongs to the thread's current turn, which T3 may not have shown Factory yet.
      const run = yield* store.readRun(located.run_id);
      const observedSince = yield* now;
      if (run?.gate_open) yield* drive(run.id, "observe");
      const verdict = yield* store.acceptReport(located.run_id, publicId, report, observedSince);
      if (report.status === "finished" && verdict.code === "ACCEPTED" && !isClosed())
        yield* fork(drive(located.run_id, "dispatch"));
      return verdict;
    });
  }

  function listTasks(projectId: string): Effect.Effect<Result<readonly TaskSummary[]>, unknown> {
    if (!projectId)
      return Effect.succeed(
        failure("validation", "Choose a project to list Task history.", [
          { code: "project_required", path: "projectId", message: "Project id is required." },
        ]),
      );
    return store.listTasks(projectId);
  }

  function updateTask(id: string, input: unknown): Effect.Effect<Result<TaskSummary>, unknown> {
    return Effect.gen(function* () {
      const title =
        input &&
        typeof input === "object" &&
        typeof (input as { title?: unknown }).title === "string"
          ? (input as { title: string }).title.trim()
          : "";
      if (!title || title.length > TASK_TITLE_LIMIT)
        return failure(
          "validation",
          `Enter a non-empty Task title up to ${TASK_TITLE_LIMIT} characters.`,
          [{ code: "task_title", path: "title", message: "Task title is required." }],
        );
      return yield* store.renameTask(id, title);
    });
  }

  /** One best-effort interrupt per worker thread, sent once after Archive; T3 stops the thread
   * and its delegated work. Factory neither waits for nor confirms termination. */
  function interruptWorkerThreads(id: string) {
    return recoverOperation(
      Effect.gen(function* () {
        const run = yield* store.readRun(id);
        if (!run) return;
        const threads = yield* store.boundWorkers(id);
        if (!threads.length) return;
        const stop = ownedThreads.stopper(
          { target: runTarget(run), contextId: run.context_id },
          yield* freshSnapshot(),
        );
        if (!stop) return;
        for (const { thread_id: threadId } of threads)
          yield* stop({
            threadId,
            // Only the call whose Archive transition changed the Run interrupts, so that
            // transition is the claim.
            claim: Effect.succeed(true),
            clientRequestId: fingerprint(`${id}:archive:${threadId}`),
          });
      }),
      () => Effect.void,
    );
  }

  /** Archive and manual settlement cancel a pending title generation; its cleanup follows in the
   * background, whatever the action answered. */
  function followTitleCleanup<A>(id: string, action: Effect.Effect<A, unknown>) {
    return Effect.tap(action, () => fork(reconcileTitleGeneration(id)));
  }

  /** Archive is final and completes in the acceptance lane; interruption follows in the background,
   * only when this call archived the Run, so the request never waits for T3. `requestId`
   * attributes the Archive to that request. */
  function archiveRun(id: string, requestId?: string): Effect.Effect<Result<RunDetail>, unknown> {
    return followTitleCleanup(
      id,
      whenOpen(
        Effect.gen(function* () {
          const archived = yield* store.archive(id, requestId);
          if (!archived.ok) return archived;
          if (archived.value) yield* fork(interruptWorkerThreads(id));
          return yield* getRun(id);
        }),
      ),
    );
  }

  /**
   * Manual Settle of an Active or Snoozed Run. Without `stopWorkers` it settles only when fresh
   * reads confirm every bound worker finished. With it, the Run store closes the gate and records
   * the attempt before any Stop, the answer shows it stopping, and the first pass follows in the
   * background. Repeating Settle while stopping changes nothing; `stopWorkers` on an unresolved
   * settlement starts the next attempt.
   */
  function settleRun(
    id: string,
    input: unknown,
  ): Effect.Effect<Result<RunSettlementOutcome>, unknown> {
    return followTitleCleanup(
      id,
      whenOpen(
        Effect.gen(function* () {
          if (!validSettleInput(input))
            return failure(
              "validation",
              "Send the Settle options as an object whose only field, stopWorkers, is true or false.",
            );
          const stopWorkers = input.stopWorkers === true;
          const run = yield* store.readRun(id);
          if (!run) return failure("not_found", "This Run does not exist.");
          if (run.archived_at) return failure("conflict", "An archived Run cannot be settled.");
          if (!stopWorkers) return yield* settlement.settleIfFinished(id);
          return yield* beginStopAndSettle(id, {
            authorization: "user-confirmed",
            reason: "manual",
          });
        }),
      ),
    );
  }

  /** Records the authorized stop-and-settle attempt with its reason, closing the gate before any
   * Stop, answers the Run as stopping and forks the first pass. A repeat while stopping changes
   * nothing; one on an unresolved settlement starts the next attempt. */
  function beginStopAndSettle(id: string, request: StopAndSettle) {
    return Effect.gen(function* (): Effect.fn.Return<Result<RunSettlementOutcome>, unknown> {
      const accepted = yield* store.acceptSettlement(id, request.reason);
      if (!accepted.ok) return accepted;
      const outcome = yield* settlement.currentOutcome(id);
      if (accepted.value) yield* fork(settlement.advanceSettlement(id));
      return outcome;
    });
  }

  /** Stops the Run's workers and settles it for an authorization that needs no dialog, as the
   * Flow's. Refused while Factory closes and for an Archived Run. */
  function stopAndSettle(
    id: string,
    request: StopAndSettle,
  ): Effect.Effect<Result<RunSettlementOutcome>, unknown> {
    return followTitleCleanup(id, whenOpen(beginStopAndSettle(id, request)));
  }

  /** Request report checks eligibility and T3 readiness, records the request and dispatches it
   * before answering. */
  function requestReport(runId: string, input: unknown): Effect.Effect<Result<RunDetail>, unknown> {
    return whenOpen(
      Effect.gen(function* () {
        if (
          typeof input !== "object" ||
          input === null ||
          !("blockId" in input) ||
          typeof input.blockId !== "string" ||
          !input.blockId
        )
          return failure("validation", "Choose the Block to request a report from.");
        const blockId = input.blockId;
        const detail = yield* getRun(runId);
        if (!detail.ok) return detail;
        const b = detail.value.blocks.find((block) => block.blockId === blockId);
        if (!b) return failure("not_found", "This Block is not part of the Run.");
        if (
          detail.value.recoveries.some(
            (r) => r.blockId === blockId && r.sourceExecutionId === b.executionId,
          )
        )
          return detail;
        const visit = detail.value.activations.filter((a) => a.blockId === blockId).at(-1);
        const current = yield* store.readRun(runId);
        // A Continuation's work runs on the thread its prompt was sent to.
        const promptBinding = detail.value.continuationVisits.find(
          (entry) => entry.blockId === blockId && entry.kind === "prompt",
        )?.bindingId;
        const blockThread =
          b.threadId ??
          detail.value.threadBindings.find((binding) => binding.id === promptBinding)?.threadId;
        if (
          !current ||
          !blockThread ||
          !b.executionId ||
          !visit ||
          detail.value.reports.some((r) => r.activationId === visit.id && r.status === "finished")
        )
          return failure(
            "conflict",
            "Request report needs an Agent Block or Continuation with a worker thread and no finished result for its current visit. Refresh the Run.",
          );
        const threadId = blockThread,
          executionId = b.executionId;
        const preflight = yield* recoverOperation(
          Effect.gen(function* () {
            if (
              (yield* freshSnapshot()).contextId !== current.context_id ||
              !(yield* recoveryReady(t3, current, threadId, executionId))
            )
              return failure(
                "conflict",
                "Request report needs the worker thread finished in T3 with no run newer than the one Factory observed.",
              );
            return { ok: true as const, value: undefined };
          }),
          () =>
            Effect.succeed(
              failure(
                "conflict",
                "The worker thread cannot be read from T3. Refresh before requesting a report.",
              ),
            ),
        );
        if (!preflight.ok) return preflight;
        const accepted = yield* store.acceptRequestReport(current, {
          blockId,
          threadId,
          executionId,
          activationId: visit.id,
        });
        if (!accepted.ok) return accepted;
        yield* drive(current.id, "dispatch");
        return yield* getRun(current.id);
      }),
    );
  }

  return {
    answerHumanOccurrence,
    continueWaitArrival,
    consumeBlockUpdate,
    listTasks,
    updateTask,
    archiveRun,
    settleRun,
    stopAndSettle,
    requestReport,
  };
}
