import type { FlowBlock } from "@t3-factory/contracts";

import { fingerprint } from "../fingerprint.ts";

const blockLabelLimit = 24;
const threadTitleLimit = 200;
const separator = " · ";
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

type TitleBlock = Pick<FlowBlock, "id" | "kind" | "name">;

function singleLine(text: string) {
  return text.replace(/\p{White_Space}+/gu, " ").trim();
}

function clip(text: string, budget: number) {
  if (Array.from(text).length <= budget) return text;
  let prefix = "";
  let remaining = budget - 1;
  for (const { segment } of graphemes.segment(text)) {
    remaining -= Array.from(segment).length;
    if (remaining < 0) break;
    prefix += segment;
  }
  return `${prefix}…`;
}

function labelHeading(label: string) {
  return (label ? ` ${label}` : "") + separator;
}

function reserveShorterHeadings(labels: readonly string[]) {
  const reserved = new Set<string>();
  for (const label of labels) {
    const heading = labelHeading(label);
    const finalSeparator = heading.length - separator.length;
    for (let index = heading.indexOf(separator); index < finalSeparator;) {
      reserved.add(heading.slice(0, index + separator.length));
      index = heading.indexOf(separator, index + 1);
    }
  }
  return reserved;
}

function blockLabels(blocks: readonly TitleBlock[]) {
  const agents = blocks
    .filter((block) => block.kind === "agent")
    .map((block) => {
      const name = singleLine(block.name);
      return { id: block.id, name, base: clip(name, blockLabelLimit) };
    });
  const counts = new Map<string, number>();
  for (const { base } of agents) counts.set(base, (counts.get(base) ?? 0) + 1);
  const reservedHeadings = reserveShorterHeadings([...counts.keys()]);
  const used = new Set(agents.map(({ base }) => base.replace(/(^| )\(0+(?=\d+\)$)/u, "$1(")));
  const ordinals = new Map<string, number>();
  return new Map(
    agents.map(({ id, name, base }) => {
      if (counts.get(base) === 1 && !reservedHeadings.has(labelHeading(base)))
        return [id, base] as const;
      let ordinal = ordinals.get(base) ?? 0;
      let label: string;
      do {
        const suffix = ` (${++ordinal})`;
        label = `${clip(name, blockLabelLimit - suffix.length)}${suffix}`.trimStart();
      } while (used.has(label) || reservedHeadings.has(labelHeading(label)));
      used.add(label);
      ordinals.set(base, ordinal);
      return [id, label] as const;
    }),
  );
}

export function workerTitleRequestId(runId: string, threadId: string, revision: number) {
  return fingerprint(JSON.stringify(["worker-title-rename", runId, threadId, revision]));
}

export function workerThreadTitle(
  run: { readonly number: number | null; readonly title: string },
  blocks: readonly TitleBlock[],
  blockId: string,
): string {
  const label = blockLabels(blocks).get(blockId);
  if (label === undefined) throw Error("Title target is not an Agent Block");
  const prefix = run.number === null ? "F" : `F#${run.number}`;
  const heading = prefix + labelHeading(label);
  return heading + clip(singleLine(run.title), threadTitleLimit - Array.from(heading).length);
}
