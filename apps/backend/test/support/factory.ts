import { type TestContext } from "@effect/vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  factoryLayer,
  FactoryService,
  openFactory,
  type Factory,
  type FactoryOptions,
} from "../../src/index.ts";
import { unavailableGitHub } from "../../src/adapters/github.ts";
import { ControlledGit } from "./controlled-git.ts";

/**
 * Real storage and restartable backend lifetime, without leaking persistence internals. GitHub is
 * unavailable and same-host Git is the harness's controlled Git unless a test passes its own
 * adapter, so no test runs the host's `gh` or `git`.
 */
export async function factoryHarness(context: TestContext) {
  // Canonical, as a configured data home is, so a server reopening it sees the same paths.
  const directory = await realpath(await mkdtemp(join(tmpdir(), "t3-factory-")));
  const databasePath = join(directory, "factory.sqlite");
  const opened: Factory[] = [];
  context.onTestFinished(async () => {
    for (const factory of opened) await factory.close();
    await rm(directory, { recursive: true, force: true });
  });
  const git = new ControlledGit();
  return {
    databasePath,
    processHome: directory,
    git,
    async open(options: Omit<FactoryOptions, "databasePath"> = {}) {
      const factory = await openFactory({
        databasePath,
        reportingStateDirectory: join(directory, "reporting-state"),
        github: unavailableGitHub,
        git,
        ...options,
      });
      opened.push(factory);
      return factory;
    },
    /** Backend services in the test's scope, so TestClock drives their background work. */
    service(options: Omit<FactoryOptions, "databasePath"> = {}) {
      return Layer.build(
        factoryLayer({
          databasePath,
          reportingStateDirectory: join(directory, "reporting-state"),
          github: unavailableGitHub,
          git,
          ...options,
        }),
      ).pipe(Effect.map(Context.get(FactoryService)));
    },
  };
}
