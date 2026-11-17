import { assert, type TestContext } from "@effect/vitest";
import { join } from "node:path";
import { factoryHarness } from "./factory.ts";
import { PersistentGitHub } from "../../../../scripts/dev/persistent-github.ts";
import { PersistentT3 } from "../../../../scripts/dev/persistent-t3.ts";
import { seedDevelopment } from "../../../../scripts/dev/seed.ts";

/** The same public seed and persisted external simulator used by pnpm dev. */
export async function restoredDevelopmentDemo(c: TestContext) {
  const h = await factoryHarness(c);
  const reportingStateDirectory = join(h.processHome, "reporting-t3-state");
  const t3 = new PersistentT3(h.processHome, false);
  const github = new PersistentGitHub(h.processHome, false);
  const f = await h.open({ t3, github, reportingStateDirectory });
  const seeded = await seedDevelopment(f, t3, github, h.processHome);
  const projects = await f.listProjects();
  assert(projects.ok);
  const project = projects.value.projects[0]!;
  const listed = await f.listRuns(project.id);
  assert(listed.ok);
  const navigation = await f.listRunNavigation();
  assert(navigation.ok);
  const working = navigation.value.find((r) => r.title.includes("Working ·"))!;
  const before = await f.getRun(working.id);
  assert(before.ok);
  const flow = await f.getFlow(before.value.flowId);
  assert(flow.ok);
  const edited = await f.updateFlow(flow.value.id, {
    ...flow.value,
    name: "Retained development edit",
    expectedRevision: flow.value.revision,
  });
  assert(edited.ok);
  t3.save();
  github.save();
  await f.close();
  const restored = new PersistentT3(h.processHome, true);
  const reopened = await h.open({
    t3: restored,
    github: new PersistentGitHub(h.processHome, true),
    reportingStateDirectory,
  });
  return {
    f: reopened,
    t3: restored,
    before: before.value,
    edited: edited.value,
    projectId: project.id,
    count: listed.value.length,
    triggerStartedRun: seeded.triggerStartedRun,
  };
}
