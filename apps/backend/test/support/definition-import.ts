import type { TestContext } from "@effect/vitest";
import { DatabaseSync } from "node:sqlite";
import type { PortableAgent, RawBody } from "@t3-factory/contracts";
import { DEFINITION_REQUEST_LIMIT_BYTES } from "@t3-factory/domain-validation";
import { ControlledT3 } from "./controlled-t3.ts";
import { factoryHarness } from "./factory.ts";
import { blockExit, continuationStep, controlledExecution, flowInput } from "./scenarios.ts";

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

const fullPrompt = "x".repeat(120_000);

/** A Flow of Continuation steps whose last prompt fills the definition body as given. */
const longChecklist = (lastPrompt: string) => ({
  name: "Long checklist",
  graph: {
    blocks: [
      ...Array.from({ length: 16 }, (_, index) =>
        continuationStep(`step-${index}`, `Step ${index}`, fullPrompt),
      ),
      continuationStep("step-16", "Step 16", lastPrompt),
    ],
    connections: [],
    flowInput: flowInput(),
  },
  workspace: { mode: "checkout" },
});

/** A Flow whose create request is `bytes` under the 2 MB definition limit. */
export function flowUnderCreateLimitBy(bytes: number) {
  const room =
    DEFINITION_REQUEST_LIMIT_BYTES - bytes - Buffer.byteLength(JSON.stringify(longChecklist("")));
  return longChecklist("x".repeat(room));
}

/** The same JSON content with every object's fields in reverse order, as another serializer may write it. */
export function withReversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withReversedKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, entry]) => [key, withReversedKeys(entry)]),
  );
}

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

/** A version-1 Flow file: a Code review block of `exportedAgent()` whose pass reaches a Human step. */
export const flowFile = () => ({
  ...agentFile(),
  kind: "flow",
  flow: {
    name: "Reviewed change",
    graph: {
      blocks: [
        {
          id: "review",
          name: "Code review",
          kind: "agent",
          position: { x: 240, y: 0 },
          agentKey: "agent-1",
          hiddenExitIds: [],
          localExits: [],
          revisitInstruction: "",
        },
        { id: "approve", name: "Approve", kind: "human", position: { x: 480, y: 0 } },
      ],
      connections: [{ sourceBlockId: "review", exitId: "pass", targetBlockId: "approve" }],
      flowInput: { position: { x: 0, y: 0 }, targetBlockIds: ["review"] },
    },
    workspace: { mode: "worktree", base: { kind: "default" } },
  },
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
 * A Factory that cannot insert rows into `table`, so a commit fails after it created earlier
 * definitions in the same transaction.
 */
export async function factoryFailingInserts(context: TestContext, table: string) {
  const harness = await factoryHarness(context);
  const first = await harness.open({ t3: new ControlledT3() });
  await first.close();
  const database = new DatabaseSync(harness.databasePath);
  database.exec(
    `CREATE TRIGGER failing_insert BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'storage failed'); END`,
  );
  database.close();
  return harness.open({ t3: new ControlledT3() });
}
