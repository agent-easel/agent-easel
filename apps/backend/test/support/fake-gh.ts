import { type TestContext } from "@effect/vitest";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveGitHubAdapter, type LiveGitHubOptions } from "../../src/adapters/live-github.ts";

interface FakeAnswer {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exit?: number;
  /** Replaces the answer, such as `exec /bin/sleep 5`. */
  readonly script?: string;
}

/** The repository the fake `gh` answers for. */
export const fakeRepository = {
  host: "github.com",
  nameWithOwner: "octo/atlas",
  nodeId: "R_atlas",
} as const;

/** One GraphQL search page for `repositoryId`, holding no issues. */
export const emptySearchPage = (repositoryId: string = fakeRepository.nodeId) =>
  JSON.stringify({
    data: {
      repository: { id: repositoryId },
      search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
    },
  });

/**
 * Directories holding fake `gh` executables that record their arguments. The adapter runs with an
 * explicit PATH and HOME and no fallback directories unless given, so it never finds a real `gh`.
 */
export async function fakeGh(context: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "t3-factory-gh-")));
  context.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  await mkdir(home);
  const argsFile = join(root, "args");

  return {
    /** A directory holding a `gh` that gives `answer` to every call. */
    async directory(name: string, answer: FakeAnswer = {}) {
      const directory = join(root, name);
      await mkdir(directory);
      await writeFile(join(directory, "stdout"), answer.stdout ?? "");
      await writeFile(join(directory, "stderr"), answer.stderr ?? "");
      const gh = join(directory, "gh");
      await writeFile(
        gh,
        [
          "#!/bin/sh",
          `printf '%s\\0' "$@" > '${argsFile}'`,
          answer.script ??
            [
              `/bin/cat '${join(directory, "stdout")}'`,
              `/bin/cat '${join(directory, "stderr")}' >&2`,
              `exit ${answer.exit ?? 0}`,
            ].join("\n"),
        ].join("\n"),
      );
      await chmod(gh, 0o755);
      return directory;
    },
    adapter(path: readonly string[], options: LiveGitHubOptions = {}) {
      return new LiveGitHubAdapter({
        environment: { PATH: path.join(":"), HOME: home },
        fallbackDirectories: [],
        ...options,
      });
    },
    /** The arguments of the latest `gh` call, each exactly as the process received it. */
    async lastArguments() {
      return (await readFile(argsFile, "utf8")).split("\0").slice(0, -1);
    },
  };
}
