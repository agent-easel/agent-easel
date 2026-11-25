import { type TestContext } from "@effect/vitest";
import { existsSync, rmSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  factoryLayer,
  FactoryService,
  openFactory,
  type AgentEasel,
  type FactoryOptions,
} from "../../src/index.ts";
import { unavailableGitHub } from "../../src/adapters/github.ts";
import { ControlledGit } from "./controlled-git.ts";

let templatePromise: Promise<string> | undefined;

async function createTemplateDatabase(): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "agenteasel-template-")));
  const databasePath = join(directory, "factory.sqlite");
  process.once("exit", () => rmSync(directory, { recursive: true, force: true }));
  const factory = await openFactory({ databasePath });
  await factory.close();
  return databasePath;
}

function templateDatabase(): Promise<string> {
  return (templatePromise ??= createTemplateDatabase().catch((error) => {
    templatePromise = undefined;
    throw error;
  }));
}

export async function seedTemplateDatabase(databasePath: string): Promise<void> {
  if (existsSync(databasePath)) return;
  const source = await templateDatabase();
  await mkdir(dirname(databasePath), { recursive: true, mode: 0o700 });
  await copyFile(source, databasePath);
}

/**
 * Real storage and restartable backend lifetime, without leaking persistence internals. GitHub is
 * unavailable and same-host Git is the harness's controlled Git unless a test passes its own
 * adapter, so no test runs the host's `gh` or `git`.
 */
export async function factoryHarness(
  context: TestContext,
  options: { readonly freshDatabase?: boolean } = {},
) {
  const freshDatabase = options.freshDatabase ?? false;
  // Canonical, as a configured data home is, so a server reopening it sees the same paths.
  const directory = await realpath(await mkdtemp(join(tmpdir(), "agenteasel-")));
  const databasePath = join(directory, "factory.sqlite");
  const opened: AgentEasel[] = [];
  context.onTestFinished(async () => {
    for (const factory of opened) await factory.close();
    await rm(directory, { recursive: true, force: true });
  });
  const git = new ControlledGit();
  return {
    databasePath,
    processHome: directory,
    git,
    async open(openOptions: Omit<FactoryOptions, "databasePath"> = {}) {
      if (!freshDatabase) await seedTemplateDatabase(databasePath);
      const factory = await openFactory({
        databasePath,
        reportingStateDirectory: join(directory, "reporting-state"),
        github: unavailableGitHub,
        git,
        ...openOptions,
      });
      opened.push(factory);
      return factory;
    },
    /** Backend services in the test's scope, so TestClock drives their background work. */
    service(openOptions: Omit<FactoryOptions, "databasePath"> = {}) {
      return (
        freshDatabase ? Effect.void : Effect.promise(() => seedTemplateDatabase(databasePath))
      ).pipe(
        Effect.andThen(
          Layer.build(
            factoryLayer({
              databasePath,
              reportingStateDirectory: join(directory, "reporting-state"),
              github: unavailableGitHub,
              git,
              ...openOptions,
            }),
          ),
        ),
        Effect.map(Context.get(FactoryService)),
      );
    },
  };
}
