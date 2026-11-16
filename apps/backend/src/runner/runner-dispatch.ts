import { dispatchBlockLaunch } from "./runner-block-workers.ts";
import {
  previousVisitReleased,
  releaseAtPreparation,
  releaseAtReservation,
  type Release,
} from "./handoff-release.ts";
import type { EffectOperations } from "../effect-operations.ts";
import { recoverOperation } from "./runner-effects.ts";
import { recoveryDispatchGeneration } from "./runner-recovery.ts";
import type { FactoryOperations } from "@t3-factory/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type { SendPayload, SendReference, T3Adapter } from "../adapters/t3.ts";
import type { Delivery, Handoff, RunStore, ScheduledWait } from "./run-store/run-store.ts";
import { intactPayload } from "../fingerprint.ts";
import {
  runTarget,
  type BlockRow,
  type Checked,
  type RunnerOptions,
  type RunRow,
  type StoredTarget,
} from "./runner-types.ts";
import { catalogProject, unverified, verified } from "./runner-utils.ts";
import { inRunWorkspace, launchStrategy } from "./run-workspace.ts";
import type { RunImages } from "../run-images.ts";
/** A Human occurrence, Wait arrival or Condition arrival from a durable Human answer, Wait
 * forwarding, Condition selection or pass-through needs no generation guard; one from a released
 * Final result requires the release's generation. */
const arrivalGeneration = (release: Exclude<Release, { state: "held" }>) =>
  release.state === "durable" ? undefined : release.run.generation;
/** Uncertain work may be replayed only within the retry scope recorded at reservation. */
const replayUnproven = (delivery: Delivery, retryScope: string | null) =>
  delivery.state !== "pending" && (!delivery.retry_scope || delivery.retry_scope !== retryScope);
function storedPayload(intent: Delivery): Checked<SendPayload> {
  if (!intactPayload(intent)) return unverified("Stored operation payload cannot be verified.");
  const payload = JSON.parse(intent.payload_json) as SendPayload;
  if (payload.clientRequestId !== intent.request_key)
    return unverified("Stored operation request key cannot be verified.");
  return verified(payload);
}
/** The stored target must still name the Run's accepted endpoint, environment and checkout. */
function storedTarget(
  runRow: RunRow,
  intent: Delivery,
  payload: SendPayload,
): Checked<StoredTarget> {
  const target = JSON.parse(intent.target_json) as StoredTarget;
  if (
    target.endpoint !== runRow.endpoint ||
    target.environmentId !== runRow.environment_id ||
    payload.environmentId !== runRow.environment_id ||
    target.projectId !== runRow.t3_project_id ||
    target.workspaceRoot !== runRow.workspace_root ||
    payload.threadId !== target.threadId ||
    payload.mode !== "queue"
  )
    return unverified("Stored operation target cannot be verified.");
  return verified(target);
}
const targetKind = (runRow: RunRow, handoff: Handoff) =>
  runRow.definitions.flow.graph.blocks.find((block) => block.id === handoff.block_id)?.kind;
/** Accepting a Handoff at a Condition sends nothing to T3 and commits atomically: a failed attempt,
 * such as unavailable storage, committed nothing, so the Handoff stays pending for the next pass.
 * It is never noted as uncertain T3 work. */
const retriedNextPass = <A, R>(attempt: Effect.Effect<A, unknown, R>) =>
  attempt.pipe(
    Effect.asVoid,
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.void,
    ),
  );
export function openRunnerDispatch(
  store: RunStore,
  ops: EffectOperations<FactoryOperations>,
  t3: T3Adapter,
  checkAgent: RunnerOptions["checkAgent"],
  observe: (run: RunRow, block: BlockRow, contextId: string | null) => Effect.Effect<void, unknown>,
  images: RunImages,
  scheduleWait: (wait: ScheduledWait) => Effect.Effect<void, unknown>,
) {
  /** A released Handoff to an Agent becomes a worker launch or a revisit send, a Continuation
   * Handoff a prompt send or a pass-through, a Human Handoff an occurrence, a Wait Handoff an
   * arrival whose wake-up is scheduled, and a Condition Handoff a numbered, routed arrival. A held
   * Handoff stays a Handoff; reservation asks again. */
  function prepareHandoff(
    runRow: RunRow,
    handoff: Handoff,
  ): Effect.Effect<Delivery | undefined, unknown> {
    return Effect.gen(function* () {
      const release = yield* releaseAtPreparation(store, t3, runRow, handoff);
      if (release.state === "held") return;
      const current = release.run;
      const kind = current.definitions.flow.graph.blocks.find(
        (block) => block.id === handoff.block_id,
      )?.kind;
      if (kind === "continuation") return yield* prepareContinuationHandoff(current, handoff);
      if (kind === "human") {
        yield* store.handoffToHumanOccurrence(current, handoff, arrivalGeneration(release));
        return;
      }
      if (kind === "wait") {
        const arrival = yield* store.handoffToWaitArrival(
          current,
          handoff,
          arrivalGeneration(release),
        );
        if (arrival) yield* scheduleWait(arrival);
        return;
      }
      if (kind === "condition") {
        yield* store.handoffToConditionArrival(current, handoff, arrivalGeneration(release));
        return;
      }
      return yield* prepareAgentHandoff(current, handoff);
    });
  }
  /** A released Agent Handoff reserves a new activation only after the recipient settles: an
   * unresolved launch for it holds the Handoff, a worktree Run's later workers wait until its
   * worktree is bound, and a revisit waits for the previous visit's result release. */
  function prepareAgentHandoff(current: RunRow, handoff: Handoff) {
    return Effect.gen(function* () {
      const arrival = yield* store.arrivalAt(current.id, handoff.block_id);
      if (arrival.launchUnresolved) return undefined;
      const strategy = launchStrategy(current.workspace, handoff.block_id);
      if (!strategy) return undefined;
      const previous = arrival.previousVisit;
      if (previous && !(yield* previousVisitReleased(store, t3, current, previous)))
        return undefined;
      return yield* store.handoffToActivation(current, handoff, previous, strategy);
    });
  }
  /** The first released Handoff to a Continuation sends its prompt (answered as the delivery), one
   * arriving while the prompt is pending waits, and later ones pass through unchanged. */
  function prepareContinuationHandoff(current: RunRow, handoff: Handoff) {
    return Effect.gen(function* () {
      const prompt = yield* store.continuationPrompt(current.id, handoff.block_id);
      if (!prompt) return yield* store.sendContinuationPrompt(current, handoff);
      if (prompt.state === "forwarded") yield* store.passThroughArrival(current, handoff);
      else if (prompt.state === "sent") yield* store.queueContinuationArrival(current, handoff);
      return undefined;
    });
  }
  /** Commits a reserved send's T3 reference with its execution record, generation and event. */
  function acknowledgeSend(
    runRow: RunRow,
    delivery: Delivery,
    reference: SendReference,
    payload: SendPayload,
  ) {
    return Effect.gen(function* () {
      if (reference.threadId !== payload.threadId)
        return yield* Effect.fail(Error("Unexpected send target"));
      yield* store.acknowledgeSend(runRow, delivery, reference);
    });
  }
  function dispatchIntent(runRow: RunRow, saved: Handoff | Delivery, contextId: string | null) {
    return Effect.gen(function* () {
      const launchRecovery = saved.kind === "launch" && saved.state !== "pending";
      if (!runRow.gate_open && !launchRecovery) return;
      if (contextId !== saved.context_id) {
        yield* store.noteUnresolved(
          saved,
          "Authorization context changed or is unavailable; operation remains unresolved.",
        );
        return;
      }
      if (saved.kind === "launch") {
        yield* dispatchBlockLaunch(store, t3, images, runRow, saved);
        const block = yield* store.readBlock(runRow.id, saved.block_id);
        if (block?.thread_id && (yield* store.readRun(runRow.id))?.gate_open)
          yield* observe(runRow, block, contextId);
        return;
      }
      if (saved.kind === "handoff" && targetKind(runRow, saved) === "condition")
        return yield* retriedNextPass(prepareHandoff(runRow, saved));
      let intent: Handoff | Delivery = saved;
      return yield* recoverOperation(
        Effect.gen(function* () {
          if (intent.kind === "handoff") {
            const prepared = yield* prepareHandoff(runRow, intent);
            if (!prepared) return;
            intent = prepared;
          }
          if (intent.kind === "launch") {
            yield* dispatchBlockLaunch(store, t3, images, runRow, intent);
            return;
          }
          const checked = yield* verifyDispatch(runRow, intent);
          if (!checked.ok) {
            yield* store.noteUnresolved(intent, checked.problem);
            return;
          }
          const { payload, retryScope } = checked.value;
          if (!(yield* reserveSend(runRow, intent, retryScope))) return;
          const reference = yield* Effect.tryPromise({
            try: () => t3.sendMessage(runTarget(runRow), payload),
            catch: (error) => error,
          });
          yield* acknowledgeSend(runRow, intent, reference, payload);
          const block = yield* store.readBlock(runRow.id, intent.block_id);
          if (block && (yield* store.readRun(runRow.id))?.gate_open)
            yield* observe(runRow, block, contextId);
        }),
        (_error) =>
          Effect.gen(function* () {
            yield* store.noteUnresolved(
              intent,
              "Operation response is uncertain. Only supported same-key reconciliation may recover it.",
            );
          }),
      );
    });
  }
  function reserveSend(runRow: RunRow, intent: Delivery, retryScope: string | null) {
    return Effect.gen(function* () {
      const release = yield* releaseAtReservation(store, t3, runRow, intent);
      if (release.state === "held") return false;
      if (release.state !== "ungated")
        return yield* store.reserveDelivery(runRow, intent, retryScope, release.run.generation);
      const generation = yield* recoveryDispatchGeneration(store, t3, runRow, intent);
      if (generation === null) return false;
      return yield* store.reserveDelivery(runRow, intent, retryScope, generation);
    });
  }
  /** Stored payload, adapter support, replay scope, checkout and target must all hold before reservation. */
  function verifyDispatch(
    runRow: RunRow,
    intent: Delivery,
  ): Effect.Effect<
    Checked<{
      payload: SendPayload;
      retryScope: string | null;
    }>,
    unknown
  > {
    return Effect.gen(function* () {
      const payload = storedPayload(intent);
      if (!payload.ok) return payload;
      const support = yield* Effect.tryPromise({
        try: () => t3.inspectSendSupport(runTarget(runRow)),
        catch: (error) => error,
      });
      if (!support.supported) return unverified(support.explanation);
      if (replayUnproven(intent, support.retryScope))
        return unverified(
          "Same-key replay continuity/retention is unproven; operation remains unresolved.",
        );
      const rebind = yield* rebindOrReadinessProblem(runRow);
      if (rebind) return unverified(rebind);
      const target = storedTarget(runRow, intent, payload.value);
      if (!target.ok) return target;
      if (
        !(intent.cause.startsWith("recovery:") && intent.state === "pending") &&
        (yield* sendTargetChanged(runRow, payload.value, target.value))
      )
        return unverified(
          "The target thread project or workspace changed; this send remains unresolved.",
        );
      return verified({ payload: payload.value, retryScope: support.retryScope });
    });
  }
  /** Even replay may create work if the original request never reached T3. */
  function rebindOrReadinessProblem(runRow: RunRow) {
    return Effect.gen(function* () {
      const ready = yield* agentsReady(runRow);
      const target = catalogProject(yield* ops.listProjects(), runRow.project_id);
      if (
        !target ||
        target.workspaceRoot !== runRow.workspace_root ||
        target.projectId !== runRow.t3_project_id
      )
        return "Project checkout changed; the accepted Run cannot be rebound.";
      if (!ready)
        return "Project/runtime readiness is unavailable; accepted operation remains pending.";
      return null;
    });
  }
  function agentsReady(runRow: RunRow) {
    return Effect.gen(function* () {
      const { definitions } = runRow;
      for (const agent of definitions.agents) {
        const readiness = yield* checkAgent(runRow.project_id, agent);
        if (!readiness.ok || !readiness.value.ready) return false;
      }
      return true;
    });
  }
  function sendTargetChanged(runRow: RunRow, payload: SendPayload, target: StoredTarget) {
    return Effect.gen(function* () {
      const observed = yield* Effect.tryPromise({
        try: () => t3.readExecution(runTarget(runRow), payload.threadId),
        catch: (error) => error,
      });
      return (
        observed.threadId !== target.threadId ||
        observed.projectId !== runRow.t3_project_id ||
        !inRunWorkspace(runRow, observed)
      );
    });
  }
  return { dispatchIntent };
}
