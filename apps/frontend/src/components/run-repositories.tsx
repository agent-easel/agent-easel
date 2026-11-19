import { Fragment } from "react";
import type { RunPullRequest, RunWorkerRepository } from "@t3-factory/contracts";
import { GitBranch, GitPullRequest } from "lucide-react";
import { TextLink } from "@/components/ui/text-link";

export function repositorySummary(workers: readonly RunWorkerRepository[]) {
  const branches = new Map<string, string[]>();
  const prs = new Map<string, RunPullRequest>();
  for (const worker of [...workers].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) {
    if (worker.branch)
      branches.set(worker.branch, [...(branches.get(worker.branch) ?? []), worker.blockName]);
    for (const pr of worker.pullRequests) prs.set(`${pr.host}/${pr.repository}/${pr.number}`, pr);
  }
  return {
    branches: [...branches].sort(([a], [b]) => a.localeCompare(b)),
    pullRequests: [...prs.values()],
  };
}

/** A branch name that wraps only after "/" or "-", never inside a word, unless one word alone is
 * wider than its line. */
export function BranchName({ branch }: { branch: string }) {
  return (
    <p className="font-mono text-xs break-words text-foreground">
      {branch.split(/(?<=[/-])/).map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <wbr />}
          {part}
        </Fragment>
      ))}
    </p>
  );
}

export function RunRepositories({
  workers,
  links = false,
  historical = false,
}: {
  workers: readonly RunWorkerRepository[];
  links?: boolean;
  historical?: boolean;
}) {
  const { branches, pullRequests } = repositorySummary(workers);
  if (!branches.length && !pullRequests.length) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2" aria-label="Worker repositories">
      {branches.map(([branch, names]) => (
        <div key={branch} className="flex items-start gap-2">
          <GitBranch aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <BranchName branch={branch} />
            {(!historical || branches.length > 1) && (
              <p className="text-2xs text-muted-foreground">{names.join(", ")}</p>
            )}
          </div>
        </div>
      ))}
      {pullRequests.map((pr) => (
        <div key={pr.url} className="flex items-start gap-2">
          <GitPullRequest aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            {links ? (
              <TextLink href={pr.url} trailing="external" className="break-all">
                {pr.repository} #{pr.number}
              </TextLink>
            ) : (
              <p className="break-all text-foreground">
                {pr.repository} #{pr.number}
              </p>
            )}
            {pr.state && <span className="text-xs text-muted-foreground"> · {pr.state}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
