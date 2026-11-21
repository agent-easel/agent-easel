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

const capturedLabels = new WeakMap<readonly TitleBlock[], ReadonlyMap<string, string>>();

function ordinalLabel(name: string, used: Set<string>, ordinals: Map<string, number>) {
  for (let digits = 1; ; digits++) {
    const stem = clip(name, blockLabelLimit - digits - 3);
    let ordinal = ordinals.get(stem) ?? 1;
    ordinal = Math.max(ordinal, 10 ** (digits - 1));
    while (ordinal < 10 ** digits && used.has((stem + ` (${ordinal})`).trimStart())) ordinal++;
    if (ordinal >= 10 ** digits) {
      ordinals.set(stem, ordinal);
      continue;
    }
    ordinals.set(stem, ordinal + 1);
    const label = (stem + ` (${ordinal})`).trimStart();
    used.add(label);
    return label;
  }
}

function blockLabels(blocks: readonly TitleBlock[]) {
  const cached = capturedLabels.get(blocks);
  if (cached) return cached;
  const agents = blocks
    .filter((block) => block.kind === "agent")
    .map((block) => {
      const name = singleLine(block.name);
      return { id: block.id, name, base: clip(name, blockLabelLimit) };
    });
  const counts = new Map<string, number>();
  for (const { base } of agents) counts.set(base, (counts.get(base) ?? 0) + 1);
  const used = new Set(agents.map(({ base }) => base.replace(/(^| )\(0+(?=\d+\)$)/u, "$1(")));
  const ordinals = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const { id, name, base } of agents) {
    if (counts.get(base) === 1) {
      labels.set(id, base);
      continue;
    }
    labels.set(id, ordinalLabel(name, used, ordinals));
  }
  capturedLabels.set(blocks, labels);
  return labels;
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
