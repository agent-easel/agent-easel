import type { FactoryProject, ValidationIssue } from "@agent-easel/contracts";
import { gitHubRepairGuidance, type GitHubAdapter } from "../adapters/github.ts";
import { isLocalEndpoint } from "../endpoint-local.ts";

export type StartIssue = { host: string; repository: string; number: number };

/** A Trigger supplies its issue directly. Manual Starts can name issue URLs or local #numbers. */
export async function completedStartIssues(
  github: GitHubAdapter,
  project: FactoryProject,
  prompt: string,
  confirmed: boolean,
  triggerIssue?: StartIssue,
): Promise<ValidationIssue[]> {
  if (confirmed && !triggerIssue) return [];
  const issues = triggerIssue ? [triggerIssue] : await promptIssues(github, project, prompt);
  const warnings: ValidationIssue[] = [];
  for (const issue of issues) {
    if (!Number.isSafeInteger(issue.number) || issue.number > 2147483647) continue;
    const result = await github.issueCompletion(issue.host, issue.repository, issue.number);
    if (!result.ok && triggerIssue)
      return [
        { code: "issue_unverified", path: "input", message: gitHubRepairGuidance(result.failure) },
      ];
    if (result.ok && result.value)
      warnings.push({
        code: "completed_issue",
        path: "input",
        message: `${issue.repository}#${issue.number} ${result.value}.`,
      });
  }
  return warnings;
}

async function promptIssues(github: GitHubAdapter, project: FactoryProject, prompt: string) {
  const issues = new Map<string, StartIssue>();
  const add = (issue: StartIssue) =>
    issues.set(`${issue.host}/${issue.repository.toLowerCase()}#${issue.number}`, issue);
  const local = new Set<number>();
  for (const match of prompt.matchAll(/https?:\/\/[^\s<>()`"']+|(?<![\w/#])#([1-9]\d*)\b/gi)) {
    if (match[1]) local.add(Number(match[1]));
    else {
      const url =
        /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/([1-9]\d*)(?:[/?#].*|[.,!;:]*)$/i.exec(
          match[0],
        );
      if (url) add({ host: "github.com", repository: url[1]!, number: Number(url[2]) });
    }
  }
  if (local.size && isLocalEndpoint(project.endpoint)) {
    const repository = await github.repository(project.workspaceRoot);
    if (repository.ok)
      for (const number of local)
        add({ host: repository.value.host, repository: repository.value.nameWithOwner, number });
  }

  return issues.values();
}
