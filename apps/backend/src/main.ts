import { loadConfiguration } from "./config.ts";
import { startServer } from "./server.ts";

const apiOnly = process.argv.includes("--api-only");

try {
  const config = await loadConfiguration();
  const server = await startServer(config, apiOnly ? { uiDirectory: null } : {});
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;
  console.log(`AgentEasel listening on http://${host}:${server.address.port}`);
  console.log(
    "AgentEasel runs in the foreground. Press Ctrl+C to exit. T3 Code runs independently.",
  );
  const shutdown = () => {
    void server.close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch (error) {
  if (error instanceof Error && error.message.startsWith("Another AgentEasel backend owns"))
    console.error(
      "Another AgentEasel backend already owns this data home — for example the AgentEasel desktop app running as a server, or another pnpm start. Quit it, then start again. AgentEasel never removes a live lock or opens a fresh data home instead.",
    );
  else if (apiOnly) console.error("AgentEasel dev backend could not start:", error);
  else
    console.error(
      "AgentEasel could not start. Check the build, data-directory permissions, configuration and bind address/port.",
    );
  process.exitCode = 1;
}
