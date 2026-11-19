import { expect, it } from "vite-plus/test";
import { checkedBot } from "../src/discord-bot-identity.ts";

it("names the bot whose saved credentials passed the check while Off, not the bot Factory last operated as", () => {
  // Arrange
  const settings = {
    chatControlEnabled: false,
    connectionStatus: "off" as const,
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
  };

  // Act
  const bot = checkedBot(settings);

  // Assert
  expect(bot).toEqual({ name: "Bot B", verified: true });
});
