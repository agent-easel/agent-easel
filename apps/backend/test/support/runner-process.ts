import { dirname, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { openFactory } from "../../src/index.ts";
import { ControlledGit } from "./controlled-git.ts";
import { ControlledT3 } from "./controlled-t3.ts";
const [databasePath, fixturePath, mode] = process.argv.slice(2);
const fixture = JSON.parse(await readFile(fixturePath!, "utf8"));
const t3 = new ControlledT3();
const launchThread = t3.threads.launchThread.bind(t3.threads);
t3.threads.launchThread = async (target, payload) => {
  const reference = await launchThread(target, payload);
  await writeFile(
    fixturePath!,
    JSON.stringify({ ...fixture, launches: [...t3.threads.launches.entries()] }),
  );
  if (mode === "crash") process.exit(86); // accepted externally; reservation still on disk
  return reference;
};
t3.connection.approve();
t3.projects = fixture.projects;
for (const [key, value] of fixture.launches ?? []) t3.threads.launches.set(key, value);
try {
  const f = await openFactory({
    databasePath: databasePath!,
    reportingStateDirectory: join(dirname(databasePath!), "reporting-state"),
    t3,
    git: new ControlledGit(),
    connectionRetryMs: 60_000,
  });
  if (mode === "hold") {
    console.log("OWNED");
    process.stdin.resume();
  } else if (mode === "crash") {
    await f.startRun(fixture.input);
    await f.reconcileRuns();
    throw Error("Expected crash");
  } else {
    const list = await f.listRuns(fixture.input.projectId);
    console.log(JSON.stringify(list));
    await f.close();
  }
} catch {
  console.log("OWNER_REJECTED");
  process.exitCode = 73;
}
