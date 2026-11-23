import { T3Failure } from "./connection.ts";

type ThreadRead = (args: Record<string, unknown>) => Promise<unknown>;

const START_TOOL_NAMES = new Set([
  "mcp__factory-runtime__factory_start_run",
  "factory-runtime.factory_start_run",
]);
const PAGES = 3;
const PAGE_ITEMS = 100;
const ITEM_CHARS = 20_000;
const MAX_ITEM_TEXT = 400_000;

type ActivityItem = {
  itemId: string;
  sourceThreadId: string;
  visibility: string;
  type: string;
  status: string;
  text: string | null;
  textTruncated: boolean;
  nextTextOffset?: number | null;
};

const isActivityItem = (value: unknown): value is ActivityItem => {
  const item = value as Record<string, unknown> | null;
  return (
    typeof item === "object" &&
    item !== null &&
    typeof item.itemId === "string" &&
    typeof item.sourceThreadId === "string" &&
    typeof item.type === "string" &&
    (item.text === null || typeof item.text === "string") &&
    typeof item.textTruncated === "boolean"
  );
};

function activityPage(body: unknown, threadId: string) {
  const page = body as {
    thread?: { threadId?: unknown };
    items?: unknown;
    earlierPosition?: unknown;
  } | null;
  if (
    !page ||
    page.thread?.threadId !== threadId ||
    !Array.isArray(page.items) ||
    !page.items.every(isActivityItem)
  )
    throw new T3Failure("invalid-response", "T3 returned an invalid thread activity page.");
  return {
    items: page.items,
    earlier: typeof page.earlierPosition === "number" ? page.earlierPosition : null,
  };
}

async function wholeText(read: ThreadRead, threadId: string, item: ActivityItem) {
  let text = item.text ?? "";
  let offset = item.textTruncated ? item.nextTextOffset : null;
  while (typeof offset === "number") {
    if (offset > MAX_ITEM_TEXT) return null;
    const { items } = activityPage(
      await read({
        threadId,
        view: "activity",
        itemId: item.itemId,
        textOffset: offset,
        maxCharsPerItem: ITEM_CHARS,
      }),
      threadId,
    );
    const next = items.find((candidate) => candidate.itemId === item.itemId);
    if (!next) return null;
    text += next.text ?? "";
    offset = next.textTruncated ? next.nextTextOffset : null;
  }
  return text;
}

function startCallKey(text: string): unknown {
  try {
    const call = JSON.parse(text) as { toolName?: unknown; input?: { requestId?: unknown } };
    return typeof call.toolName === "string" && START_TOOL_NAMES.has(call.toolName)
      ? call.input?.requestId
      : undefined;
  } catch {
    return undefined;
  }
}

export async function findStartCall(read: ThreadRead, threadId: string, requestId: string) {
  let before: number | null = null;
  for (let page = 0; page < PAGES; page++) {
    const { items, earlier } = activityPage(
      await read({
        threadId,
        view: "activity",
        limit: PAGE_ITEMS,
        maxCharsPerItem: ITEM_CHARS,
        runLimit: 1,
        ...(before === null ? {} : { beforePosition: before }),
      }),
      threadId,
    );
    for (const item of items) {
      if (
        item.type !== "dynamic_tool" ||
        item.status !== "completed" ||
        item.visibility !== "local" ||
        item.sourceThreadId !== threadId
      )
        continue;
      const text = await wholeText(read, threadId, item);
      if (text !== null && startCallKey(text) === requestId) return true;
    }
    if (earlier === null) return false;
    before = earlier;
  }
  return false;
}
