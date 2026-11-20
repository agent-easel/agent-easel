import * as Effect from "effect/Effect";
import type {
  ConditionArrivalPage,
  Result,
  RunDetail,
  RunImageMimeType,
} from "@t3-factory/contracts";
import {
  effectiveExits,
  exitsWithEndings,
  type ExitWithEndings,
} from "@t3-factory/domain-validation";
import type { RunStore } from "./run-store/run-store.ts";
import { OPEN_TRANSITIONS, type RuntimeReply } from "../runtime-types.ts";
import { reportDiagnostic } from "../runtime-report-diagnostic.ts";
import { blockIdArgument } from "../runtime-block-id.ts";
import type { RunImages } from "../run-images.ts";
import { REVISIT_RULE } from "./worker-payloads.ts";

type ImageRow = {
  image_id: string;
  ordinal: number;
  name: string;
  mime_type: RunImageMimeType;
  size_bytes: number;
};

const imageIdentity = (row: ImageRow): NonNullable<RuntimeReply["image"]> => ({
  imageId: row.image_id,
  ordinal: row.ordinal,
  name: row.name,
  mimeType: row.mime_type,
  sizeBytes: row.size_bytes,
});

/** The arguments each read accepts beside the Block id. */
const READ_FIELDS = {
  block: [],
  run: [],
  image: ["imageId"],
  conditionArrivals: ["conditionBlockId", "limit", "cursor"],
} as const satisfies Record<string, readonly string[]>;

/** Block, Run, image and Condition evidence reads addressed by the Block id from the worker's
 * message; a Condition evidence read names a Condition of that Block's Run. */
export function openBlockTools(
  store: RunStore,
  getRun: (id: string) => Effect.Effect<{ ok: true; value: RunDetail } | { ok: false }, unknown>,
  images: RunImages,
) {
  return (kind: keyof typeof READ_FIELDS, input: unknown): Effect.Effect<RuntimeReply, unknown> =>
    Effect.gen(function* () {
      const publicId = blockIdArgument(input, READ_FIELDS[kind]);
      if (typeof publicId !== "string") return reportDiagnostic(publicId);
      const fields = (input as { arguments: Record<string, unknown> }).arguments;
      if (kind === "conditionArrivals")
        return yield* readConditionArrivals(store, publicId, fields);
      if (kind === "image") {
        if (!("imageId" in fields)) return reportDiagnostic({ code: "IMAGE_ID_REQUIRED" });
        if (typeof fields.imageId !== "string" || !fields.imageId)
          return reportDiagnostic({ code: "INVALID_ARGUMENT" });
      }
      const block = yield* store.locateBlock(publicId);
      if (!block) return reportDiagnostic({ code: "UNKNOWN_BLOCK" });
      if (kind === "image")
        return yield* readImage(store, images, block.run_id, fields.imageId as string);
      const detail = yield* getRun(block.run_id);
      if (!detail.ok) return { code: "RUNTIME_UNAVAILABLE" };
      if (kind === "run") return runView(detail.value);
      const manifest = yield* store.blockImages(block.run_id);
      const routedId = conditionArrivalId(visitCause(detail.value, block.block_id));
      const routed = routedId ? yield* store.conditionArrivalMessage(block.run_id, routedId) : null;
      return blockView(detail.value, block.block_id, manifest.map(imageIdentity), routed);
    }).pipe(Effect.catchCause(() => Effect.succeed<RuntimeReply>({ code: "RUNTIME_UNAVAILABLE" })));
}

function readImage(store: RunStore, images: RunImages, runId: string, imageId: string) {
  return Effect.gen(function* () {
    const row = yield* store.blockImage(runId, imageId);
    if (!row) return reportDiagnostic({ code: "UNKNOWN_IMAGE" });
    const image = imageIdentity(row);
    return yield* Effect.suspend(() => images.storedBytes(row.sha256)).pipe(
      Effect.map((bytes): RuntimeReply =>
        bytes.kind === "ok"
          ? { code: "IMAGE", image, data: bytes.data }
          : reportDiagnostic({ code: "IMAGE_UNAVAILABLE", image }),
      ),
      Effect.catchCause(() =>
        Effect.succeed(reportDiagnostic({ code: "IMAGE_READ_FAILED", image })),
      ),
    );
  });
}

/** One page of Condition evidence for a Condition of the Block's Run: the page the HTTP read
 * answers, or the reason it was refused. */
function readConditionArrivals(
  store: RunStore,
  publicId: string,
  fields: Readonly<Record<string, unknown>>,
) {
  return Effect.gen(function* () {
    if (!("conditionBlockId" in fields))
      return reportDiagnostic({ code: "CONDITION_BLOCK_ID_REQUIRED" });
    const { conditionBlockId, limit, cursor } = fields;
    if (typeof conditionBlockId !== "string" || ("cursor" in fields && typeof cursor !== "string"))
      return reportDiagnostic({ code: "INVALID_ARGUMENT" });
    const block = yield* store.locateBlock(publicId);
    if (!block) return reportDiagnostic({ code: "UNKNOWN_BLOCK" });
    const pageSize = !("limit" in fields)
      ? undefined
      : typeof limit === "number"
        ? limit
        : Number.NaN;
    return conditionArrivalsReply(
      yield* store.listConditionArrivals(
        block.run_id,
        conditionBlockId,
        pageSize,
        cursor as string | undefined,
      ),
    );
  });
}

function conditionArrivalsReply(page: Result<ConditionArrivalPage>): RuntimeReply {
  if (page.ok) return { code: "CONDITION_ARRIVALS", ...page.value };
  if (page.error.code === "not_found") return reportDiagnostic({ code: "UNKNOWN_CONDITION" });
  return reportDiagnostic({
    code: page.error.issues[0]?.path === "limit" ? "INVALID_LIMIT" : "INVALID_CURSOR",
  });
}

/** The cause of the Block's current visit; empty before its first. */
function visitCause(detail: RunDetail, blockId: string) {
  return (
    detail.activations.filter((activation) => activation.blockId === blockId).at(-1)?.cause ?? ""
  );
}

/** The Condition arrival a visit's cause names, if a Condition routed the visit. */
const conditionArrivalId = (cause: string) => /^condition:([^/]+)/.exec(cause)?.[1];

/** `routed` is the message of the Condition arrival that started the current visit, if one did. */
function blockView(
  detail: RunDetail,
  blockId: string,
  images: NonNullable<RuntimeReply["inputs"]>["images"],
  routed: string | null,
): RuntimeReply {
  const block = detail.blocks.find((entry) => entry.blockId === blockId);
  const graphBlock = detail.definitions.flow.graph.blocks.find((entry) => entry.id === blockId);
  if (!block || !graphBlock) return reportDiagnostic({ code: "UNKNOWN_BLOCK" });
  const visits = detail.activations.filter((activation) => activation.blockId === blockId);
  const current = visits[visits.length - 1];
  const cause = current?.cause ?? "";
  // A Continuation's worker answers its prompt and finishes without naming an exit.
  const continuation = graphBlock.kind === "continuation";
  // A later visit can re-read the Revisit instruction its message carried, e.g. after compaction.
  const revisitInstruction =
    graphBlock.kind === "agent" && visits.length > 1 ? graphBlock.revisitInstruction : "";
  const exits = exitsWithEndings(
    graphBlock,
    detail.definitions.flow.graph,
    detail.definitions.agents,
  );
  return {
    code: "BLOCK",
    state: block.state,
    visit: visits.length,
    reason: continuation ? "continuation" : visitReason(cause),
    ...(continuation ? { prompt: graphBlock.prompt } : {}),
    ...(revisitInstruction ? { revisitInstruction, revisitRule: REVISIT_RULE } : {}),
    // A Continuation's single output is read as `output`; it has no exit to name.
    exits: continuation ? [] : exits.map(workerExit),
    ...(continuation
      ? { output: { messageRequired: exits[0]!.messageRequired, endings: exits[0]!.endings } }
      : {}),
    inputs: {
      input: detail.input,
      images,
      results: incomingResults(detail, cause),
      feedback: conditionArrivalId(cause) ? routed : visitFeedback(detail, cause),
    },
    allowedTransitions: current && detail.gateOpen ? OPEN_TRANSITIONS : [],
  };
}

function workerExit(exit: ExitWithEndings) {
  return {
    id: exit.id,
    name: exit.name,
    description: exit.description,
    messageRequired: exit.messageRequired,
    endings: exit.endings,
  };
}

/** Why an Agent visit started, from the cause of its activation. */
function visitReason(cause: string) {
  if (cause.startsWith("start:")) return "first";
  if (cause.startsWith("human:")) return "Human answer";
  if (cause.startsWith("wait:")) return "Wait";
  if (cause.startsWith("condition:")) return "Condition";
  return "feedback";
}

/** The result or answer that started this visit, or the message a Wait forwarded to it unchanged;
 * null once Archive cleared a Wait's message. */
function visitFeedback(detail: RunDetail, cause: string) {
  const feedbackId = /^(?:report|human):([^/]+)/.exec(cause)?.[1];
  if (feedbackId)
    return detail.reports.find((report) => report.id === feedbackId)?.resultMessage ?? null;
  const arrivalId = /^wait:([^/]+)/.exec(cause)?.[1];
  return detail.waitArrivals.find((arrival) => arrival.id === arrivalId)?.message ?? null;
}

/** One arrival activates one visit; graph neighbors and later reports are not its inputs. */
function incomingResults(detail: RunDetail, cause: string) {
  const reportId = /^report:([^/]+)/.exec(cause)?.[1];
  const report = detail.reports.find((entry) => entry.id === reportId);
  if (!report) return [];
  const source = detail.definitions.flow.graph.blocks.find((entry) => entry.id === report.blockId)!;
  return [
    {
      reportId: report.id,
      blockId: report.blockId,
      blockName: source.name,
      exitName: effectiveExits(source, detail.definitions.agents).find(
        (exit) => exit.id === report.exitId,
      )!.name,
      message: report.resultMessage ?? null,
      threadLink: detail.blocks.find((block) => block.blockId === report.blockId)!.link,
    },
  ];
}

function runView(detail: RunDetail): RuntimeReply {
  return {
    code: "RUN",
    number: detail.number,
    title: detail.title,
    input: detail.input,
    state: detail.lifecycle,
    conditions: detail.conditions,
    blocks: detail.blocks.map((block) => ({
      blockId: block.blockId,
      name: block.name,
      state: block.state,
      result:
        [...detail.reports].reverse().find((report) => report.blockId === block.blockId)
          ?.resultMessage ?? null,
    })),
  };
}
