import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { openFactory } from "../../src/index.ts";
import { ControlledGit } from "./controlled-git.ts";
import { ControlledGitHub } from "./controlled-github.ts";
import { ControlledT3, START_INSPECTIONS } from "./controlled-t3.ts";

/**
 * Owns the database, checks the Trigger and dies at `stage`: `preflight` while the check's Start
 * is in T3 preflight, after its guard was written; `accepted` when the accepted Run launches its
 * worker, before the check records its outcome. Exits 86 at the crash.
 */
const [databasePath, fixturePath, stage, triggerId] = process.argv.slice(2);
const fixture = JSON.parse(await readFile(fixturePath!, "utf8"));
const crash = async () => process.exit(86);
const t3 = new ControlledT3();
t3.connection.approve();
t3.projects = fixture.projects;
if (stage === "accepted") t3.threads.beforeLaunch = crash;
const github = new ControlledGitHub();
for (const [root, repository] of fixture.repositories) github.repositories.set(root, repository);
github.issues.push(...fixture.issues);
const f = await openFactory({
  databasePath: databasePath!,
  reportingStateDirectory: join(dirname(databasePath!), "reporting-state"),
  t3,
  git: new ControlledGit(),
  github,
  connectionRetryMs: 60_000,
});
if (stage === "preflight") {
  // The check's own launch-blocker read inspects T3 as its Start does; the next inspection is that
  // Start's T3 contract snapshot.
  let inspections = 0;
  t3.contract.beforeInspection = async () => {
    if (++inspections === START_INSPECTIONS + 1) await crash();
  };
}
await f.runTrigger(triggerId!);
await f.reconcileRuns();
