import type { RunActivation, RunDetail, RunThreadBinding } from "@t3-factory/contracts";
import { OpenInT3 } from "./open-in-t3.tsx";
import { InspectorHeading } from "./inspector-section.tsx";
import { attentionLinkedBlocks } from "./run-attention.tsx";
import { ResultCard } from "./run-result.tsx";

export const bindingRole: Record<RunThreadBinding["role"], string> = {
  worker: "Worker",
  descendant: "Descendant",
};

export function BindingLink({ binding }: { binding: RunThreadBinding }) {
  const role = bindingRole[binding.role];
  return binding.link ? (
    <OpenInT3 href={binding.link} className="text-xs" />
  ) : (
    <span>{role} link unavailable</span>
  );
}

export function CoordinatorActivations({ run, blockId }: { run: RunDetail; blockId?: string }) {
  const activations = run.activations.filter((a) => !blockId || a.blockId === blockId);
  if (!activations.length) return null;
  return (
    <section aria-label="Block activations" className="flex flex-col gap-2.5">
      <InspectorHeading title="Activations" />
      {activations.map((activation) => (
        <Activation key={activation.id} run={run} activation={activation} />
      ))}
    </section>
  );
}

function Activation({ run, activation }: { run: RunDetail; activation: RunActivation }) {
  const visit =
    run.activations
      .filter((a) => a.blockId === activation.blockId)
      .findIndex((a) => a.id === activation.id) + 1;
  const report = run.reports.findLast((r) => r.activationId === activation.id);
  const name = run.blocks.find((b) => b.blockId === activation.blockId)?.name ?? activation.blockId;
  // A thread a pending Attention card already opens gets no second link here, and the card
  // states the visit's problem, whose raw reason stays in its Technical details.
  const linked = attentionLinkedBlocks(run).has(activation.blockId);
  const problem =
    run.lifecycle !== "archived" &&
    !run.attention.some((item) => item.blockId === activation.blockId && !item.settledAt) &&
    activation.problem;
  const coordination = (
    <>
      {problem && <p className="text-xs text-attention">{problem}</p>}
      {run.threadBindings
        .filter((b) => b.blockId === activation.blockId && !(b.link && linked))
        .map((binding) => (
          <div key={binding.id} className="flex flex-col gap-1 text-xs">
            <BindingLink binding={binding} />
            {binding.role === "descendant" && (
              <span className="font-mono text-2xs break-all text-muted-foreground">
                {binding.threadId}
              </span>
            )}
          </div>
        ))}
    </>
  );
  // A reported visit reads as its result; the coordination facts follow inside the same card.
  if (report)
    return (
      <ResultCard run={run} report={report}>
        {coordination}
      </ResultCard>
    );
  const workers = run.threadBindings.flatMap((binding) =>
    binding.blockId === activation.blockId && binding.role === "worker" && binding.link && !linked
      ? [{ id: binding.id, link: binding.link }]
      : [],
  );
  return (
    <article
      aria-label={`${name} · Visit ${visit}`}
      className="flex flex-col gap-2 rounded-md border bg-card px-3 py-2.5 text-xs break-words"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-sm font-semibold">{name}</span>
        <span className="shrink-0 text-subtle-foreground">
          <span className="sr-only"> · </span>Visit {visit}
        </span>
        <span className="flex-1" />
        {workers.map((worker) => (
          <OpenInT3 key={worker.id} href={worker.link} className="text-sm" />
        ))}
      </div>
      {problem && <p className="text-xs text-attention">{problem}</p>}
      {run.threadBindings
        .filter((b) => b.blockId === activation.blockId && b.role === "descendant")
        .map((binding) => (
          <div key={binding.id} className="flex flex-col gap-1 text-xs">
            <BindingLink binding={binding} />
            <span className="font-mono text-2xs break-all text-muted-foreground">
              {binding.threadId}
            </span>
          </div>
        ))}
    </article>
  );
}
