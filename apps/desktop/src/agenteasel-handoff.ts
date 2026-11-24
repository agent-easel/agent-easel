import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { app, dialog, shell } from "electron";

export const tombstoneName = "migrated-to-agenteasel.json";
const agentEaselDownloadUrl = "https://agenteasel.app/";

export const factoryDataHome = () => process.env.FACTORY_HOME ?? join(homedir(), ".t3-factory");

export const migratedToAgentEasel = (userData: string, dataHome: string): boolean =>
  existsSync(join(userData, tombstoneName)) || existsSync(join(dataHome, tombstoneName));

function openAgentEasel(): Promise<void> {
  return new Promise((resolve) =>
    execFile("/usr/bin/open", ["-a", "AgentEasel"], (error) => {
      if (error) void shell.openExternal(agentEaselDownloadUrl);
      resolve();
    }),
  );
}

const applicationBundle = () => dirname(dirname(dirname(process.execPath)));

async function moveToTrash(): Promise<void> {
  const bundle = applicationBundle();
  if (!app.isPackaged || !bundle.endsWith(".app")) {
    dialog.showErrorBox(
      "T3 Factory was not moved",
      "This is not an installed T3 Factory app. Remove it yourself.",
    );
    return;
  }
  await shell.trashItem(bundle).catch((error: unknown) => {
    dialog.showErrorBox(
      "T3 Factory was not moved to the Trash",
      `Drag T3 Factory from Applications to the Trash yourself.\n\n${String(error)}`,
    );
  });
}

export async function handOffToAgentEasel(): Promise<void> {
  app.setLoginItemSettings({ openAtLogin: false });
  const { response } = await dialog.showMessageBox({
    type: "info",
    buttons: ["Open AgentEasel", "Move T3 Factory to Trash", "Quit"],
    defaultId: 0,
    cancelId: 2,
    message: "T3 Factory has moved to AgentEasel",
    detail:
      "AgentEasel brought over your Flows, Agents, Triggers, Run history and settings. T3 Factory no longer starts its server, so the two apps never work on separate data, and it no longer opens at login. Your previous T3 Factory data stays as a backup until you delete it in AgentEasel's Settings.",
  });
  if (response === 0) await openAgentEasel();
  if (response === 1) await moveToTrash();
  app.exit(0);
}
