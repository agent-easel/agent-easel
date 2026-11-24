import { expect, it } from "vite-plus/test";
import type { DiscordSettings } from "@agent-easel/contracts";
import { chatControlBlocker } from "../src/chat-control-switch.ts";

const configuration = (publicKey: string | null, tokenConfigured: boolean) => ({
  publicKey,
  tokenConfigured,
  revision: 2,
  savedAt: "2026-11-18T10:00:00.000Z",
});
const check = (outcome: NonNullable<DiscordSettings["latestCheck"]>["outcome"], revision = 2) => ({
  revision,
  checkedAt: "2026-11-18T10:01:00.000Z",
  outcome,
  applicationId: null,
  botName: null,
  message: "",
});
const discord = (
  overrides: Partial<Pick<DiscordSettings, "configuration" | "latestCheck" | "chatControlEnabled">>,
) => ({
  chatControlEnabled: false,
  configuration: configuration("a".repeat(64), true),
  latestCheck: null,
  ...overrides,
});

it("names the bot and a language model when nothing is saved", () => {
  // Act
  const blocker = chatControlBlocker(
    discord({ configuration: configuration(null, false) }),
    "incomplete",
  );

  // Assert
  expect(blocker).toStrictEqual({ kind: "save", bot: "the bot", model: true });
});

it("names only the missing bot token when the model and Public key are saved", () => {
  // Act
  const blocker = chatControlBlocker(
    discord({ configuration: configuration("a".repeat(64), false) }),
    "complete",
  );

  // Assert
  expect(blocker).toStrictEqual({ kind: "save", bot: "the bot token", model: false });
});

it("a rejected token or a refused intent of the saved revision keeps the switch off", () => {
  // Act
  const rejected = chatControlBlocker(
    discord({ latestCheck: check("token-rejected") }),
    "complete",
  );
  const intent = chatControlBlocker(
    discord({ latestCheck: check("intent-disallowed") }),
    "complete",
  );
  const earlier = chatControlBlocker(
    discord({ latestCheck: check("token-rejected", 1) }),
    "complete",
  );

  // Assert
  expect([rejected, intent, earlier]).toStrictEqual([
    { kind: "rejected" },
    { kind: "intent" },
    null,
  ]);
});

it("a model that is still being read or could not be read keeps the switch off", () => {
  // Act
  const reading = chatControlBlocker(discord({}), "reading");
  const unread = chatControlBlocker(discord({}), "unread");
  const bot = chatControlBlocker(discord({ configuration: configuration(null, true) }), "unread");

  // Assert
  expect([reading, unread, bot]).toStrictEqual([
    { kind: "model", state: "reading" },
    { kind: "model", state: "unread" },
    { kind: "save", bot: "the Public key", model: false },
  ]);
});

it("turning Off is never blocked", () => {
  // Act
  const blocker = chatControlBlocker(
    discord({ chatControlEnabled: true, latestCheck: check("token-rejected") }),
    "incomplete",
  );

  // Assert
  expect(blocker).toBeNull();
});
