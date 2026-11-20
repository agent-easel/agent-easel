import { assert } from "@effect/vitest";
import { DatabaseSync } from "node:sqlite";
import { T3Failure } from "../../src/t3/connection.ts";
import type { ControlledT3 } from "./controlled-t3.ts";
import {
  launchBlockId,
  report,
  workingReport,
  type ScenarioWorld,
  type WorkerHandle,
} from "./scenarios.ts";

/** A launch message: the Block skill, the Block id line, then the turn's body. */
export function workerMessage(body: string) {
  return new RegExp(
    `^\\$factory-block\\n\\nFactory Block id: [0-9a-f-]{36}\\. Pass it as blockId to factory_get_block, factory_get_run, factory_get_run_image and factory_update_block\\.\\n\\n${body.replaceAll(".", "\\.")}$`,
  );
}

/**
 * Stores every revision of a closed backend's Agent without execution settings, bypassing the
 * revision immutability guard: the corrupt state a Run's captured revision must never launch from.
 */
export function clearStoredExecution(databasePath: string, agentId: string) {
  const database = new DatabaseSync(databasePath);
  const guard = "immutable_agent_revision_update";
  const [{ sql }] = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
    .all(guard) as [{ sql: string }];
  database.exec(`DROP TRIGGER ${guard}`);
  database
    .prepare(
      "UPDATE agent_revisions SET environment_id = NULL, provider_instance_id = NULL, model_id = NULL, model_options_json = NULL WHERE agent_id = ?",
    )
    .run(agentId);
  database.exec(sql);
  database.close();
}

/** The worker launch T3 received for the named Block. */
export function blockLaunch(t3: ControlledT3, blockName: string) {
  return [...t3.threads.launches.values()].find((entry) =>
    entry.payload.title.endsWith(` ${blockName}`),
  );
}

/** The Block id Factory stated in a worker's launch message, as an Agent reads it. */
export function launchedBlockId(t3: ControlledT3, blockName = "Entry worker") {
  return launchBlockId(blockLaunch(t3, blockName)?.payload.message ?? "");
}

/** Resolves once T3 receives the next thread settlement, which Factory sends in the background
 * after a manual Settle. */
export function nextSettlement(t3: ControlledT3) {
  const settle = t3.threads.settleThread.bind(t3.threads);
  return new Promise<void>((resolve) => {
    t3.threads.settleThread = async (target, payload) => {
      await settle(target, payload);
      resolve();
    };
  });
}

/** Resolves once T3 receives the next thread interrupt, which Factory sends in the background
 * after Archive. */
export function nextThreadInterrupt(t3: ControlledT3) {
  const interrupt = t3.threads.stopThread.bind(t3.threads);
  return new Promise<void>((resolve) => {
    t3.threads.stopThread = async (target, payload) => {
      await interrupt(target, payload);
      resolve();
    };
  });
}

/** The next worker thread read, such as Request report's preflight, waits for a complete
 * background sweep that observes the unchanged worker; reads during that sweep pass through. */
export function sweepDuringNextThreadRead({ factory, t3 }: ScenarioWorld) {
  const read = t3.threads.readExecution.bind(t3.threads);
  let sweep: Promise<unknown> | undefined;
  t3.threads.readExecution = (...args) => {
    if (sweep) return read(...args);
    sweep = factory.reconcileRuns();
    return sweep.then(() => read(...args));
  };
}

/** A new working report arrives during the per-Block sweep's external completion read, the
 * first delegated-settlement read after the next sweep's second inspection: its observe pass
 * takes the first, the per-Block sweep the second. */
export function reopenDuringSettlement(world: ScenarioWorld, worker: WorkerHandle) {
  const { t3 } = world;
  const read = t3.threads.readDelegatedSettlement.bind(t3.threads);
  let inspections = 0;
  t3.contract.beforeInspection = () => {
    if (++inspections < 2) return;
    delete t3.contract.beforeInspection;
    t3.threads.readDelegatedSettlement = async (...args) => {
      t3.threads.readDelegatedSettlement = read;
      assert((await report(world, worker, workingReport())) === "ACCEPTED");
      return read(...args);
    };
  };
}

/** The user confirms Settle while T3 receives the next worker launch, before Factory has its reply. */
export function settleDuringNextLaunch({ factory, t3 }: ScenarioWorld, runId: string) {
  t3.threads.beforeLaunch = async () => {
    delete t3.threads.beforeLaunch;
    assert((await factory.settleRun(runId, { stopWorkers: true })).ok);
  };
}

/** T3 cannot answer the next worker thread read, such as the observation a report triggers. */
export function failNextThreadRead(t3: ControlledT3) {
  const read = t3.threads.readExecution.bind(t3.threads);
  t3.threads.readExecution = async () => {
    t3.threads.readExecution = read;
    throw new T3Failure("unavailable", "T3 is unreachable.");
  };
}

/** T3 authorization changes to another grant right after T3 answers the next worker thread
 * read, such as a settlement pass's read under its snapshot. */
export function changeAuthorizationAfterNextRead(t3: ControlledT3) {
  const read = t3.threads.readExecution.bind(t3.threads);
  t3.threads.readExecution = async (target, threadId) => {
    t3.threads.readExecution = read;
    const thread = await read(target, threadId);
    t3.connection.approve("different-grant");
    return thread;
  };
}

/** T3 cannot answer the first inspection after it answers the next worker thread read, such as a
 * settlement pass's recheck before its Stop; resolves once that inspection was asked. */
export function failInspectionAfterNextRead(t3: ControlledT3) {
  const read = t3.threads.readExecution.bind(t3.threads);
  return new Promise<void>((resolve) => {
    t3.threads.readExecution = async (target, threadId) => {
      t3.threads.readExecution = read;
      const thread = await read(target, threadId);
      void failNextInspection(t3).then(resolve);
      return thread;
    };
  });
}

/** T3 cannot answer the next inspection, such as a settlement pass's snapshot; resolves once it
 * was asked. */
export function failNextInspection(t3: ControlledT3) {
  return new Promise<void>((resolve) => {
    t3.contract.beforeInspection = () => {
      delete t3.contract.beforeInspection;
      resolve();
      throw new Error("T3 is unreachable");
    };
  });
}

/** T3 cannot read this worker until the caller restores its reads. */
export function pauseWorkerReads(t3: ControlledT3, threadId: string) {
  const read = t3.threads.readExecution.bind(t3.threads);
  t3.threads.readExecution = (target, id) =>
    id === threadId ? Promise.reject(Error("Temporary thread read failure")) : read(target, id);
  return () => {
    t3.threads.readExecution = read;
  };
}

/**
 * Removes from a closed backend's database what accepting the Run's stop-and-settle recorded,
 * leaving its reached ending: the state a crash leaves between the ending's commit and the
 * settlement's, which no public operation can stop between.
 */
export function forgetSettlementAfterEnding(databasePath: string, runId: string) {
  const database = new DatabaseSync(databasePath);
  database.prepare("DELETE FROM run_settlement_workers WHERE run_id = ?").run(runId);
  database.prepare("DELETE FROM run_settlements WHERE run_id = ?").run(runId);
  database
    .prepare("DELETE FROM run_events WHERE run_id = ? AND kind = 'settlement-requested'")
    .run(runId);
  database.close();
}
