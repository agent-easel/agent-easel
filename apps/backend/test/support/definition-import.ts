import { assert, type TestContext } from "@effect/vitest";
import { DatabaseSync } from "node:sqlite";
import * as Effect from "effect/Effect";
import type { HttpServerRequest } from "effect/http/HttpServerRequest";
import type { PortableAgent, RawBody } from "@t3-factory/contracts";
import { DEFINITION_REQUEST_LIMIT_BYTES } from "@t3-factory/domain-validation";
import { ControlledT3 } from "./controlled-t3.ts";
import { assertOk, openFactoryWithApprovedT3, sampleAgentInput } from "./domain-setup.ts";
import { factoryHarness } from "./factory.ts";
import {
  blockExit,
  connection,
  continuationStep,
  controlledExecution,
  flowInput,
  humanStep,
} from "./scenarios.ts";

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

/** An import upload under the size limit whose connection broke off before the body arrived. */
export const interruptedUpload = () =>
  ({
    headers: { "content-type": "application/json", "content-length": "300000" },
    arrayBuffer: Effect.fail(new Error("upload interrupted")),
  }) as unknown as HttpServerRequest;

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

/** An Agent file as Definition export writes it (version 2). */
export const agentFile = (agent: unknown = exportedAgent(), envelope: object = {}) => ({
  format: "t3-factory/definitions",
  formatVersion: 2,
  kind: "agent",
  factoryVersion: "0.6.0",
  exportedAt: "2026-11-14T10:00:00.000Z",
  agents: [agent],
  ...envelope,
});

/**
 * A Flow file as Definition export writes it, or as an earlier release did with `formatVersion: 1`:
 * a Code review block of `exportedAgent()` whose pass reaches a Human step.
 */
export const flowFile = (envelope: { formatVersion?: number } = {}) => ({
  ...agentFile(exportedAgent(), envelope),
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
          ...(envelope.formatVersion !== undefined && envelope.formatVersion >= 4
            ? { revisitContext: "keep" as const }
            : {}),
        },
        { id: "approve", name: "Approve", kind: "human", position: { x: 480, y: 0 } },
      ],
      connections: [{ sourceBlockId: "review", exitId: "pass", targetBlockId: "approve" }],
      flowInput: { position: { x: 0, y: 0 }, targetBlockIds: ["review"] },
      ...(envelope.formatVersion !== undefined && envelope.formatVersion >= 3
        ? { finish: { position: { x: 800, y: 0 }, endings: [] } }
        : {}),
    },
    workspace: { mode: "worktree", base: { kind: "default" } },
  },
});

export function fullLegacyFlowFile(formatVersion: 1 | 2 = 2) {
  const file = flowFile({ formatVersion });
  const [review, approve] = file.flow.graph.blocks;
  return {
    ...file,
    flow: {
      ...file.flow,
      graph: {
        blocks: [
          { ...review!, id: "finish" },
          approve!,
          ...Array.from({ length: 498 }, (_, index) => humanStep(`review-${index}`, "Review")),
        ],
        connections: [
          connection("finish", "pass", "approve"),
          connection("approve", "request-changes", "finish"),
        ],
        flowInput: flowInput("finish"),
      },
    },
  };
}

/** The bytes a chosen file sends to review: JSON text as written, or a value as exported. */
export const fileBody = (content: unknown): RawBody => ({
  mimeType: "application/json",
  data: new TextEncoder().encode(
    typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
  ),
});

/** A commit of `agentFile()` choosing the controlled catalog's model for its Agent. */
export const reviewedCommit = (
  requestId = "import-1",
  execution = controlledExecution(),
  document: object = agentFile(),
) => ({
  requestId,
  document,
  selections: { "agent-1": execution },
});

export async function importFullLegacyFlow(context: TestContext) {
  const { factory } = await openFactoryWithApprovedT3(context);
  const imported = assertOk(
    await factory.commitImport(reviewedCommit("import-full", undefined, fullLegacyFlowFile())),
  );
  return { factory, flow: assertOk(await factory.getFlow(imported.flowId!)) };
}

/** The fingerprint release 0.6.0 recorded for `reviewedCommit()` of a version-1 Agent file. */
const VERSION_1_RECEIPT_FINGERPRINT =
  "f077cb806441c7cff68a08fb6087d6d6ac59520209f8ec9e0a563cf062fea593";

/**
 * A Factory upgraded from release 0.6.0, which committed `reviewedCommit()` of a version-1 Agent
 * file and recorded its receipt for the Agent it created. That release is not runnable here, so
 * the Agent is created through the current operation and its receipt is written as 0.6.0 wrote it.
 */
export async function factoryWithVersion1Receipt(context: TestContext) {
  const harness = await factoryHarness(context);
  const first = await harness.open({ t3: new ControlledT3() });
  const created = await first.createAgent(sampleAgentInput("Code reviewer"));
  await first.close();
  assert(created.ok);
  const database = new DatabaseSync(harness.databasePath);
  database
    .prepare(
      "INSERT INTO definition_import_receipts (request_id, fingerprint, flow_id, created_at) VALUES ('import-1', ?, NULL, ?)",
    )
    .run(VERSION_1_RECEIPT_FINGERPRINT, created.value.updatedAt);
  database
    .prepare(
      "INSERT INTO definition_import_receipt_agents (request_id, ordinal, agent_key, agent_id) VALUES ('import-1', 0, 'agent-1', ?)",
    )
    .run(created.value.id);
  database.close();
  const factory = await harness.open({ t3: new ControlledT3() });
  return { factory, agentId: created.value.id };
}

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
