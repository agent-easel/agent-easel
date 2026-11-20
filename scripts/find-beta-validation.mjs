import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

async function findJourneyRun(read, repo, sha) {
  const {
    commit: { tree },
  } = await read(`${repo}/commits/${sha}`);
  const pulls = await read(`${repo}/commits/${sha}/pulls`);
  const pull = pulls.find(
    (candidate) =>
      candidate.merged_at && candidate.base.ref === "main" && candidate.merge_commit_sha === sha,
  );
  if (!pull) return;

  const actions = `${repo}/actions`;
  const {
    workflow_runs: [run],
  } = await read(
    `${actions}/workflows/ui-journeys.yml/runs?event=pull_request&head_sha=${pull.head.sha}&per_page=1`,
  );
  if (run?.conclusion !== "success") return;

  const { jobs } = await read(`${actions}/runs/${run.id}/jobs?filter=latest`);
  const result = jobs.find((job) => job.name === "Controlled UI journeys");
  if (result?.conclusion !== "success") return;

  // Actions lists PR runs under the PR head SHA. The completed suite step records
  // the synthetic merge commit actually checked out by every shard.
  const marker = result.steps.find(
    (step) =>
      step.conclusion === "success" && /^Full UI suite passed on [a-f0-9]{40}$/.test(step.name),
  );
  if (!marker) return;
  const tested = await read(`${repo}/commits/${marker.name.slice(-40)}`);
  if (tested.commit.tree.sha === tree.sha) return run.html_url;
}

export async function findBetaValidation({ read, repository, sha }) {
  const repo = `repos/${repository}`;
  const {
    workflow_runs: [quality],
  } = await read(
    `${repo}/actions/workflows/quality.yml/runs?event=push&branch=main&head_sha=${sha}&per_page=1`,
  );
  return {
    quality: quality?.conclusion === "success" ? quality.html_url : undefined,
    journeys: await findJourneyRun(read, repo, sha),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_OUTPUT, GITHUB_STEP_SUMMARY } = process.env;
  const read = (path) => JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8" }));
  const validation = await findBetaValidation({
    read,
    repository: GITHUB_REPOSITORY,
    sha: GITHUB_SHA,
  });
  for (const [check, url] of Object.entries(validation)) {
    appendFileSync(GITHUB_OUTPUT, `${check}=${Boolean(url)}\n`);
    appendFileSync(
      GITHUB_STEP_SUMMARY,
      url ? `- Reuse [${check} validation](${url}).\n` : `- Run ${check} validation on Ubuntu.\n`,
    );
  }
}
