import { expect, it } from "vite-plus/test";
import type { DiscordSettings } from "@agent-easel/contracts";
import { checkedBot } from "../src/discord-bot-identity.ts";

/**
 * Factory last operated as Bot A; the owner then saved Bot B's credentials and their check
 * verified Bot B. `overrides` describe where startup or recovery stands.
 */
const replacedBot = (overrides: Partial<Parameters<typeof checkedBot>[0]>) => ({
  chatControlEnabled: false,
  connectionStatus: "off" as DiscordSettings["connectionStatus"],
  application: "a-app",
  botName: "Bot A",
  configuration: {
    publicKey: "a".repeat(64),
    tokenConfigured: true,
    revision: 3,
    savedAt: "2026-11-18T10:00:00.000Z",
  },
  latestCheck: {
    revision: 3,
    checkedAt: "2026-11-18T10:01:00.000Z",
    outcome: "verified" as const,
    applicationId: "b-app",
    botName: "Bot B",
    message: "",
  },
  ...overrides,
});

it("names the bot whose saved credentials passed the check while Off, not the bot Factory last operated as", () => {
  // Arrange
  const settings = replacedBot({});

  // Act
  const bot = checkedBot(settings);

  // Assert
  expect(bot).toEqual({ name: "Bot B", verified: true });
});

it("keeps naming the checked replacement bot after Chat control is turned On, until the Gateway adopts it", () => {
  // Arrange
  const settings = replacedBot({ chatControlEnabled: true, connectionStatus: "connecting" });

  // Act
  const bot = checkedBot(settings);

  // Assert
  expect(bot).toEqual({ name: "Bot B", verified: true });
});

it("keeps naming the checked replacement bot when its login fails before the Gateway adopts it", () => {
  // Arrange
  const settings = replacedBot({ chatControlEnabled: true, connectionStatus: "rejected" });

  // Act
  const bot = checkedBot(settings);

  // Assert
  expect(bot).toEqual({ name: "Bot B", verified: true });
});

it("names the bot the Gateway adopted once its session is ready", () => {
  // Arrange
  const settings = replacedBot({
    chatControlEnabled: true,
    connectionStatus: "connected",
    application: "b-app",
    botName: "Bot B (renamed)",
  });

  // Act
  const bot = checkedBot(settings);

  // Assert
  expect(bot).toEqual({ name: "Bot B (renamed)", verified: true });
});
