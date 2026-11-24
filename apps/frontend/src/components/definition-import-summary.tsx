import { useId, type ReactNode } from "react";
import { Bot, FolderGit2, Workflow } from "lucide-react";
import type {
  ImportReviewAgent,
  ImportReviewFlow,
  ImportReviewInstruction,
} from "@agent-easel/contracts";
import { StatusBadge } from "./status-badge.tsx";
import { workspaceSummary } from "./flow-workspace-control.tsx";

export function ImportReviewSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className="grid gap-1.5">
      <h3 id={heading} className="text-2xs font-medium text-muted-foreground">
        {title}
      </h3>
      {description && (
        <p className="text-2xs tracking-label text-muted-foreground">{description}</p>
      )}
      <div className="grid overflow-hidden rounded-lg border bg-background">{children}</div>
    </section>
  );
}

const reviewIconClass = "size-4 shrink-0 text-muted-foreground";

export function ImportFlowList({
  flows,
  owner,
}: {
  flows: readonly ImportReviewFlow[];
  owner: string;
}) {
  if (!flows.length) return null;
  return (
    <ImportReviewSection title={`Flows · ${flows.length} · created in ${owner}`}>
      {flows.map((flow) => (
        <div key={flow.key} className="flex items-start gap-2.5 px-3 py-2 not-first:border-t">
          <Workflow aria-hidden className={reviewIconClass} strokeWidth={1.5} />
          <div className="grid min-w-0 gap-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm leading-none font-medium wrap-anywhere">{flow.name}</span>
              <span className="text-2xs tracking-label text-subtle-foreground">
                {flow.blockCount} {flow.blockCount === 1 ? "block" : "blocks"}
              </span>
              {flow.opensAfterImport && <StatusBadge kind="info">Opens after import</StatusBadge>}
              {flow.usesItself && <StatusBadge kind="neutral">Uses itself</StatusBadge>}
            </div>
            {flow.uses.length > 0 && (
              <p className="text-2xs tracking-label wrap-anywhere text-muted-foreground">
                Used in{" "}
                {flow.uses
                  .map(({ flowName, blockName }) => `${flowName} · ${blockName}`)
                  .join(", ")}
              </p>
            )}
          </div>
        </div>
      ))}
    </ImportReviewSection>
  );
}

export function ImportWorkspaceList({ flows }: { flows: readonly ImportReviewFlow[] }) {
  const [root] = flows;
  if (!root) return null;
  const description =
    flows.length === 1
      ? `A Run started from ${root.name} uses this workspace.`
      : `A Run started from ${root.name} uses its workspace for every Subflow inside it. Each other Flow’s own workspace applies only when that Flow is started on its own.`;
  return (
    <ImportReviewSection title="Workspace" description={description}>
      {flows.map((flow) => (
        <div
          key={flow.key}
          className="grid gap-x-2 gap-y-1 px-3 py-2 text-sm leading-none not-first:border-t sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)_auto]"
        >
          <span className="wrap-anywhere">{flow.name}</span>
          <span className="flex min-w-0 gap-2 wrap-anywhere">
            <FolderGit2
              aria-hidden
              className="size-3.5 shrink-0 text-subtle-foreground"
              strokeWidth={1.5}
            />
            {workspaceSummary(flow.workspace)}
          </span>
          <span className="self-center text-2xs tracking-label text-subtle-foreground">
            {flow.opensAfterImport ? "Runs started from the root" : "Started on its own"}
          </span>
        </div>
      ))}
    </ImportReviewSection>
  );
}

function instructionLabel(instruction: ImportReviewInstruction) {
  switch (instruction.kind) {
    case "agent":
      return `Agent prompt · ${instruction.agentName}`;
    case "continuation":
      return "Continuation prompt";
    case "revisit":
      return "Revisit instruction";
  }
}

export function ImportInstructions({
  flows,
  agents,
  count,
  length,
}: {
  flows: readonly ImportReviewFlow[];
  agents: readonly ImportReviewAgent[];
  count: number;
  length: number;
}) {
  return (
    <ImportReviewSection
      title={`Instructions · ${count.toLocaleString()} · ${length.toLocaleString()} characters`}
    >
      {flows
        .filter((flow) => flow.instructions.length > 0)
        .map((flow) => (
          <div key={flow.key} className="grid gap-1 px-3 py-2 not-first:border-t">
            <h4 className="flex items-center gap-2 text-sm leading-none wrap-anywhere">
              <Workflow
                aria-hidden
                className="size-3.5 shrink-0 text-muted-foreground"
                strokeWidth={1.5}
              />
              {flow.name}
            </h4>
            <ul className="grid gap-1 pl-5.5">
              {flow.instructions.map((instruction) => (
                <li
                  key={`${instruction.blockId}:${instruction.kind}`}
                  className="grid gap-x-2 gap-y-0.5 text-2xs wrap-anywhere sm:grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto]"
                >
                  <span>{instruction.blockName}</span>
                  <span className="tracking-label text-muted-foreground">
                    {instructionLabel(instruction)}
                  </span>
                  <span className="tracking-label text-subtle-foreground">
                    {instruction.length.toLocaleString()} characters
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      {!flows.length &&
        agents.map((agent) => (
          <div key={agent.key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-2xs">
            <Bot aria-hidden className={reviewIconClass} strokeWidth={1.5} />
            {agent.name}
            <span className="ml-auto tracking-label text-subtle-foreground">
              {agent.promptLength.toLocaleString()} characters
            </span>
          </div>
        ))}
    </ImportReviewSection>
  );
}
