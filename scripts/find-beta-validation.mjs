import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

async function findMergedPull(read, repo, sha) {
  const {
    commit: { tree },
  } = await read(`${repo}/commits/${sha}`);
  const pulls = await read(`${repo}/commits/${sha}/pulls`);
  const pull = pulls.find(
    (candidate) =>
      candidate.merged_at && candidate.base.ref === "main" && candidate.merge_commit_sha === sha,
  );
  return { treeSha: tree.sha, pull };
}

async function findRunWithMarker(
  read,
  repo,
  workflow,
  headSha,
  jobName,
  markerPattern,
  treeSha,
  perPage,
) {
  const actions = `${repo}/actions`;
  const { workflow_runs: runs } = await read(
    `${actions}/workflows/${workflow}/runs?event=pull_request&head_sha=${headSha}&per_page=${perPage}`,
  );
  const run = runs.find((candidate) => !candidate.display_title?.startsWith("Reuse code gate"));
  if (run?.conclusion !== "success") return;

  const { jobs } = await read(`${actions}/runs/${run.id}/jobs?filter=latest`);
  const result = jobs.find((job) => job.name === jobName);
  if (result?.conclusion !== "success") return;

  // Actions lists PR runs under the PR head SHA. The completed suite step records
  // the synthetic merge commit actually checked out by every shard.
  const marker = result.steps.find(
    (step) => step.conclusion === "success" && markerPattern.test(step.name),
  );
  if (!marker) return;
  const tested = await read(`${repo}/commits/${marker.name.slice(-40)}`);
  if (tested.commit.tree.sha === treeSha) return run.html_url;
}

export async function findBetaValidation({ read, repository, sha }) {
  const repo = `repos/${repository}`;
  const {
    workflow_runs: [quality],
  } = await read(
    `${repo}/actions/workflows/quality.yml/runs?event=push&branch=main&head_sha=${sha}&per_page=1`,
  );
  const { treeSha, pull } = await findMergedPull(read, repo, sha);
  const qualityUrl =
    quality?.conclusion === "success"
      ? quality.html_url
      : pull
        ? await findRunWithMarker(
            read,
            repo,
            "quality.yml",
            pull.head.sha,
            "Quality gate",
            /^Full quality gate passed on [a-f0-9]{40}$/,
            treeSha,
            10,
          )
        : undefined;
  const journeysUrl = pull
    ? await findRunWithMarker(
        read,
        repo,
        "ui-journeys.yml",
        pull.head.sha,
        "Controlled UI journeys",
        /^Full UI suite passed on [a-f0-9]{40}$/,
        treeSha,
        1,
      )
    : undefined;
  return {
    quality: qualityUrl,
    journeys: journeysUrl,
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
