import type { BlockExit } from "@agent-easel/contracts";
import { canonical } from "./revisioned-draft.ts";

/** A display line can carry a hidden comparison key when two stored choices share a label. */
export type RevisionLine = string | { readonly text: string; readonly key: string };

export const revisionLine = (text: string, value: unknown): RevisionLine => ({
  text,
  key: canonical([text, value]),
});

export function revisionExitLines(exit: BlockExit, heading: string): RevisionLine[] {
  return [
    revisionLine(
      `${heading}${exit.name || "(unnamed)"}${exit.messageRequired ? " · message required" : ""}`,
      exit.id,
    ),
    ...(exit.description ? exit.description.split("\n").map((line) => `      ${line}`) : []),
  ];
}

const comparisonKey = (line: RevisionLine) => (typeof line === "string" ? line : line.key);
const MAX_DIFF_CELLS = 1_000_000;

function markMatches(
  left: readonly string[],
  right: readonly string[],
  start: number,
  mineChanged: boolean[],
  theirsChanged: boolean[],
) {
  const width = right.length + 1;
  const cells = (left.length + 1) * width;
  // Large dissimilar drafts still show every line. Bound quadratic work on the changed region.
  if (cells > MAX_DIFF_CELLS || !left.length || !right.length) return;
  const lengths = new Uint32Array(cells);
  for (let row = left.length - 1; row >= 0; row--) {
    for (let col = right.length - 1; col >= 0; col--) {
      const index = row * width + col;
      lengths[index] =
        left[row] === right[col]
          ? 1 + lengths[index + width + 1]!
          : Math.max(lengths[index + width]!, lengths[index + 1]!);
    }
  }
  let row = 0;
  let col = 0;
  while (row < left.length && col < right.length) {
    const index = row * width + col;
    if (left[row] === right[col]) {
      mineChanged[start + row++] = false;
      theirsChanged[start + col++] = false;
    } else if (lengths[index + width]! >= lengths[index + 1]!) {
      row++;
    } else {
      col++;
    }
  }
}

/** Match lines in order, at most once each, so repeated and moved instructions remain visible. */
export function diffRevisionLines(mine: readonly RevisionLine[], theirs: readonly RevisionLine[]) {
  const left = mine.map(comparisonKey);
  const right = theirs.map(comparisonKey);
  let start = 0;
  let leftEnd = left.length;
  let rightEnd = right.length;
  while (start < leftEnd && start < rightEnd && left[start] === right[start]) start++;
  while (start < leftEnd && start < rightEnd && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd--;
    rightEnd--;
  }
  const mineChanged = left.map((_, index) => index >= start && index < leftEnd);
  const theirsChanged = right.map((_, index) => index >= start && index < rightEnd);
  markMatches(
    left.slice(start, leftEnd),
    right.slice(start, rightEnd),
    start,
    mineChanged,
    theirsChanged,
  );
  return { mineChanged, theirsChanged };
}
