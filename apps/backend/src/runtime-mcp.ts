import {
  createMcpHandler,
  Server,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/server";
import {
  CONDITION_ARRIVAL_PAGE_DEFAULT,
  CONDITION_ARRIVAL_PAGE_MAX,
  SUBFLOW_INVOCATION_PAGE_MAX,
} from "@t3-factory/contracts";
import {
  authoringTools,
  callAuthoringTool,
  textResult,
  type AuthoringOperations,
} from "./authoring-tools.ts";
import { definitionBody } from "./http-support.ts";
import {
  callLaunchTool,
  launchTools,
  STAGE_REQUEST_LIMIT_BYTES,
  type LaunchOperations,
} from "./launch-tools.ts";
import { callRunReadTool, runReadTools, type RunReadOperations } from "./run-read-tools.ts";
import { callRunActionTool, runActionTools, type RunActionOperations } from "./run-action-tools.ts";
import {
  callRunLifecycleTool,
  runLifecycleTools,
  type RunLifecycleOperations,
} from "./run-lifecycle-tools.ts";
import {
  callStartDiagnosisTool,
  startDiagnosisTools,
  type StartDiagnosisOperations,
} from "./start-diagnosis-tools.ts";
import {
  callRunTitleSettingTool,
  runTitleSettingTools,
  type RunTitleSettingOperations,
} from "./run-title-setting-tools.ts";
import { callTriggerTool, triggerTools, type TriggerToolOperations } from "./trigger-tools.ts";
import { SUCCESS_CODES, type RuntimeReply } from "./runtime-types.ts";

const blockIdProperty = {
  type: "string",
  description:
    "Your Block id from the Factory Block id line of this thread's Factory message. Only the Block's own worker passes it; subagents do not call Factory tools.",
} as const;

const tools: Tool[] = [
  {
    name: "factory_update_block",
    description:
      "Report your Block's state. working needs a nonempty message saying what you are doing or waiting on and no exit; report it when you start this visit's work, and again only to replace that message or when you reopen the task. It stays current across later turns of the visit, so asking the user questions and reading their replies need no report: end a questioning turn with the questions as your final message. finished needs one of the Block's exits and a message for the next Block (required when the exit requires a message); report it only when the task is complete, never while questions, CI, review, delegated or background work are still open. The newest finished report is the visit's result, so a later one replaces it (after hand-off the same exit only updates the result, and a different exit also starts that exit's next Blocks). Your latest report is the Block's current report. Repeating the same report returns the same acknowledgement.",
    inputSchema: {
      type: "object",
      properties: {
        blockId: blockIdProperty,
        to: { type: "string", enum: ["working", "finished"] },
        exit: {
          type: "string",
          description:
            "finished only: exact exit name or ID from the exits factory_get_block lists.",
        },
        message: {
          type: "string",
          description:
            "working: what you are doing or waiting on. finished: the result for the next Block.",
        },
      },
      required: ["blockId", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "factory_get_block",
    description:
      "Read your Block's current visit: state, why it was activated, its inputs, exits {id, name, description, messageRequired, endings} and allowed reports. An exit's endings [{id, name, description, output, outputDescription}] are the Run endings it enters; output none, optional or required says whether the message becomes the Run result, and messageRequired already includes a required ending. A prompted Continuation lists no exits; its output {messageRequired, endings} describes the same for its result. inputs.images is an ordered manifest {imageId, ordinal, name, mimeType, sizeBytes}; ordinal N matches [Image N: name] in the Run input. Fetch an image with factory_get_run_image; this read carries no image bytes. On a later visit of a Block with a Revisit instruction, revisitInstruction and revisitRule restate it.",
    inputSchema: {
      type: "object",
      properties: { blockId: blockIdProperty },
      required: ["blockId"],
      additionalProperties: false,
    },
  },
  {
    name: "factory_get_run_image",
    description:
      "Return one original image of the Run's initial prompt as image content. Fetch only images relevant to your task. This read is read-only and safe to repeat.",
    inputSchema: {
      type: "object",
      properties: {
        blockId: blockIdProperty,
        imageId: {
          type: "string",
          description: "An imageId from factory_get_block inputs.images.",
        },
      },
      required: ["blockId", "imageId"],
      additionalProperties: false,
    },
  },
  {
    name: "factory_get_run",
    description:
      "Read the Run your Block belongs to (id, number, title, input, state, startedAt), with each Block's state and latest result, each Condition's summary {blockId, arrivals, pending, latest} without its arrival history, each Join's summary {blockId, round, sources, arrived, queued, latest {round, outcome forwarded or cancelled, at}} without its rounds or arrivals, and the Run result once the Run reached an ending: result {endingId, endingName, output (null when the ending takes no output), outputMissing, sourceBlockId, exitId, authorBlockId, origin, deliveryId, acceptedAt}, else null.",
    inputSchema: {
      type: "object",
      properties: { blockId: blockIdProperty },
      required: ["blockId"],
      additionalProperties: false,
    },
  },
  {
    name: "factory_get_condition_arrivals",
    description:
      "Read one page of a Condition's numbered arrivals in your Block's Run, oldest first: each arrival's number, acceptance time, source block and worker, matched rule {id, name} or null for Otherwise, selected output, and each recipient's blockId, targetEndingId (null for an ordinary block), and current disposition (pending, acknowledged or cancelled; none when the output is unwired). A selected route is not proof its recipient received it. The first page fixes the window at the highest arrival number then; pass its nextCursor to continue that window, and omit cursor to see newer arrivals. Read-only and safe to repeat.",
    inputSchema: {
      type: "object",
      properties: {
        blockId: blockIdProperty,
        conditionBlockId: {
          type: "string",
          description: "The Condition's blockId from the conditions factory_get_run lists.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: CONDITION_ARRIVAL_PAGE_MAX,
          description: `Arrivals per page, 1 to ${CONDITION_ARRIVAL_PAGE_MAX}; ${CONDITION_ARRIVAL_PAGE_DEFAULT} when omitted.`,
        },
        cursor: {
          type: "string",
          description:
            "The nextCursor of the previous page for this Condition; omit it for a first page.",
        },
      },
      required: ["blockId", "conditionBlockId"],
      additionalProperties: false,
    },
  },
  {
    name: "factory_get_join",
    description:
      "Read one Join of your Block's Run: the round it is collecting and, for each captured source in order, its name, its oldest waiting arrival {exitId, exitName, arrivedAt} or null while that source is still pending, the count of later queued arrivals and the oldest of them, plus the Join's latest outcome {round, outcome forwarded or cancelled, at}. No message text is returned: a forwarded round's combined message reaches its recipients as their feedback. Read-only and safe to repeat.",
    inputSchema: {
      type: "object",
      properties: {
        blockId: blockIdProperty,
        joinBlockId: {
          type: "string",
          description: "The Join's blockId from the joins factory_get_run lists.",
        },
      },
      required: ["blockId", "joinBlockId"],
      additionalProperties: false,
    },
  },
  {
    name: "factory_get_subflow_invocations",
    description:
      "Read a Subflow placement’s invocation history in your Run, newest first. Use its placement Block id from factory_get_run or an invocation’s inner Blocks. A cursor continues the same placement and first page’s high-water mark.",
    inputSchema: {
      type: "object",
      properties: {
        blockId: blockIdProperty,
        placementBlockId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: SUBFLOW_INVOCATION_PAGE_MAX },
        cursor: { type: "string" },
      },
      required: ["blockId", "placementBlockId"],
      additionalProperties: false,
    },
  },
  {
    name: "factory_set_run_title",
    description:
      "Submit the Run title your Factory title message asks for. Only the title thread that received the titleGenerationId calls this; it takes no Block id. Factory trims surrounding whitespace and accepts one non-empty line of at most 120 characters (Unicode code points) without control characters; it never shortens a title. A rejected title can be corrected and submitted again while the generation is pending. The first accepted title is final; repeating it returns the same acknowledgement.",
    inputSchema: {
      type: "object",
      properties: {
        titleGenerationId: {
          type: "string",
          description: "The titleGenerationId stated in this thread's Factory title message.",
        },
        title: { type: "string", description: "The Run title." },
      },
      required: ["titleGenerationId", "title"],
      additionalProperties: false,
    },
  },
];

const operations = {
  factory_update_block: "submit",
  factory_get_block: "block",
  factory_get_run: "run",
  factory_get_run_image: "image",
  factory_get_subflow_invocations: "subflowInvocations",
  factory_get_condition_arrivals: "conditionArrivals",
  factory_get_join: "join",
  factory_set_run_title: "title",
} as const;

/** Runtime operations behind the tools; each receives the call's arguments. */
export interface RuntimeTools {
  submit(input: unknown): Promise<RuntimeReply>;
  block(input: unknown): Promise<RuntimeReply>;
  run(input: unknown): Promise<RuntimeReply>;
  image(input: unknown): Promise<RuntimeReply>;
  subflowInvocations(input: unknown): Promise<RuntimeReply>;
  conditionArrivals(input: unknown): Promise<RuntimeReply>;
  join(input: unknown): Promise<RuntimeReply>;
  title(input: unknown): Promise<RuntimeReply>;
}

async function callTool(
  runtime: RuntimeTools,
  name: keyof typeof operations,
  args: unknown,
): Promise<CallToolResult> {
  try {
    const body = await runtime[operations[name]]({ arguments: args });
    const { data, ...reply } = body;
    const text = { type: "text" as const, text: JSON.stringify(reply) };
    if (reply.code === "IMAGE") {
      if (!data || !reply.image) throw new Error("Image reply is missing content");
      return {
        isError: false,
        content: [
          text,
          {
            type: "image",
            data: Buffer.from(data).toString("base64"),
            mimeType: reply.image.mimeType,
          },
        ],
      };
    }
    return {
      isError: !SUCCESS_CODES.includes(reply.code),
      content: [text],
    };
  } catch {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "RUNTIME_UNAVAILABLE: no success asserted. Recheck the owning Factory backend.",
        },
      ],
    };
  }
}

const fitsDefinitionBody = (args: unknown) =>
  Buffer.byteLength(JSON.stringify(args ?? null)) <= definitionBody.bytes;

/**
 * Stateless Streamable HTTP MCP server for harness reporting, Run titles, definition authoring and
 * Run Start. Reporting calls name their Block by Block id and title calls their title generation;
 * authoring and Start calls need neither. The server holds no identity: any local caller of this
 * host-local endpoint may start a Run.
 */
export function runtimeMcpHandler(
  runtime: RuntimeTools,
  definitions: AuthoringOperations &
    LaunchOperations &
    RunReadOperations &
    RunLifecycleOperations &
    StartDiagnosisOperations &
    RunActionOperations &
    RunTitleSettingOperations &
    TriggerToolOperations,
): (request: Request) => Promise<Response> {
  const handler = createMcpHandler(
    () => {
      const server = new Server(
        { name: "factory-runtime", version: "1.0.0" },
        { capabilities: { tools: {} } },
      );
      server.setRequestHandler("tools/list", () => ({
        tools: [
          ...tools,
          ...authoringTools,
          ...launchTools,
          ...startDiagnosisTools,
          ...runReadTools,
          ...runLifecycleTools,
          ...runActionTools,
          ...runTitleSettingTools,
          ...triggerTools,
        ],
      }));
      server.setRequestHandler("tools/call", async (request) => {
        const { name, arguments: args } = request.params;
        if (name !== "factory_stage_run_image" && !fitsDefinitionBody(args))
          return textResult(true, {
            code: "validation",
            message: "Send arguments up to 2 MB.",
            issues: [
              {
                code: "request_too_large",
                path: "arguments",
                message: "Only image staging accepts a larger call.",
              },
            ],
            next: "Nothing was changed. Send a smaller call.",
          });
        if (Object.hasOwn(operations, name))
          return callTool(runtime, name as keyof typeof operations, args);
        return (
          (await callAuthoringTool(definitions, name, args)) ??
          (await callLaunchTool(definitions, name, args)) ??
          (await callStartDiagnosisTool(definitions, name, args)) ??
          (await callRunReadTool(definitions, name, args)) ??
          (await callRunLifecycleTool(definitions, name, args)) ??
          (await callRunActionTool(definitions, name, args)) ??
          (await callRunTitleSettingTool(definitions, name, args)) ??
          (await callTriggerTool(definitions, name, args)) ?? {
            isError: true,
            content: [{ type: "text", text: `Unknown tool ${name}.` }],
          }
        );
      });
      return server;
    },
    // A Flow save carries a whole graph, as Studio's Flow document body does.
    { maxRequestBodySize: Math.max(definitionBody.bytes, STAGE_REQUEST_LIMIT_BYTES) },
  );
  return (request) => handler.fetch(request);
}
