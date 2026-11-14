import type { TestContext } from "@effect/vitest";
import { DatabaseSync } from "node:sqlite";
import type { PortableAgent, RawBody } from "@t3-factory/contracts";
import { ControlledT3 } from "./controlled-t3.ts";
import { factoryHarness } from "./factory.ts";
import { blockExit, controlledExecution } from "./scenarios.ts";

/** The Agent another installation exported: its hint names a provider instance this one lacks. */
export const exportedAgent = (overrides: Partial<PortableAgent> = {}): PortableAgent => ({
  key: "agent-1",
  name: "Code reviewer",
  prompt: "Review the change and report pass or fail.",
  model: {
    driverKind: "codex",
    providerInstanceId: "codex-elsewhere",
    modelId: "gpt-6.1-sol",
    modelOptions: [{ id: "reasoning", value: "high" }],
  },
  exits: [blockExit("pass", "pass", "The change is ready."), blockExit("fail", "fail", "", true)],
  ...overrides,
});

/** A version-1 Agent file as Definition export writes it. */
export const agentFile = (agent: unknown = exportedAgent(), envelope: object = {}) => ({
  format: "t3-factory/definitions",
  formatVersion: 1,
  kind: "agent",
  factoryVersion: "0.6.0",
  exportedAt: "2026-11-14T10:00:00.000Z",
  agents: [agent],
  ...envelope,
});

/** The bytes a chosen file sends to review: JSON text as written, or a value as exported. */
export const fileBody = (content: unknown): RawBody => ({
  mimeType: "application/json",
  data: new TextEncoder().encode(
    typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
  ),
});

/** A commit of `agentFile()` choosing the controlled catalog's model for its Agent. */
export const reviewedCommit = (requestId = "import-1", execution = controlledExecution()) => ({
  requestId,
  document: agentFile(),
  selections: { "agent-1": execution },
});

/**
 * A Factory whose import receipts cannot be written, so a commit fails after it created its
 * definitions in the same transaction.
 */
export async function factoryFailingImportReceipts(context: TestContext) {
  const harness = await factoryHarness(context);
  const first = await harness.open({ t3: new ControlledT3() });
  await first.close();
  const database = new DatabaseSync(harness.databasePath);
  database.exec(
    "CREATE TRIGGER failing_import_receipt BEFORE INSERT ON definition_import_receipts BEGIN SELECT RAISE(ABORT, 'receipt storage failed'); END",
  );
  database.close();
  return harness.open({ t3: new ControlledT3() });
}
