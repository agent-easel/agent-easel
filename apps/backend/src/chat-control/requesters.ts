import type { ChatActionOperation } from "@t3-factory/contracts";

export type RequesterKind = "human" | "bot";

export type Requesters = RequesterKind | "human-or-bot";

export const ACTION_REQUESTERS: Readonly<Record<ChatActionOperation, Requesters>> = {
  start: "human-or-bot",
  "human-answer": "human",
  archive: "human",
};

export const admits = (requesters: Requesters, kind: RequesterKind) =>
  requesters === "human-or-bot" || requesters === kind;
