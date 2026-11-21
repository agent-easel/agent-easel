import type { FlowLayoutDimensions, LayoutBlock, LayoutGraph } from "./index.ts";
import { incomingIndex } from "./graph.ts";

type BlockPorts = { inputY: number; firstExitY: number; exitRow: number };
export type CanvasDimensions = {
  readonly block: {
    readonly width: number;
    readonly border: number;
    readonly header: number;
    readonly title: number;
    readonly divider: number;
    readonly exitPaddingTop: number;
    readonly exitPaddingBottom: number;
    readonly inputY: number;
    readonly exitRow: number;
    readonly footer: number;
  };
  readonly flowInput: {
    readonly width: number;
    readonly border: number;
    readonly header: number;
    readonly title: number;
    readonly outputY: number;
    readonly promptLine: number;
    readonly promptImages: number;
    readonly statusLine: number;
  };
  readonly finish: {
    readonly title: number;
  };
  readonly port: {
    readonly size: number;
    readonly handle: number;
    readonly highlight: number;
  };
};
function dimensionPorts({ block }: CanvasDimensions): BlockPorts {
  return {
    inputY: block.inputY,
    firstExitY:
      block.border +
      block.header +
      block.title +
      block.divider +
      block.exitPaddingTop +
      block.exitRow / 2,
    exitRow: block.exitRow,
  };
}

export type BlockFrame = {
  readonly width: number;
  readonly height: number;
  readonly inputY: number;
  readonly exitY: (exitId: string) => number | undefined;
};

export type GeometryFacts<B extends LayoutBlock = LayoutBlock> = {
  readonly prompt?: "none" | "line" | "images";
  readonly flowInputStatus?: boolean;
  readonly footerCount?: (block: B) => number;
  readonly reservedFooterCount?: number;
  readonly emptyGraphSize?: { readonly width: number; readonly height: number } | undefined;
  readonly finish?: boolean;
  readonly blockFrame?: ((block: B) => BlockFrame | undefined) | undefined;
};

export const AUTHORING_DIMENSIONS: CanvasDimensions = {
  block: {
    width: 240,
    border: 1,
    header: 30,
    title: 44,
    divider: 1,
    exitPaddingTop: 4,
    exitPaddingBottom: 6,
    inputY: 51,
    exitRow: 24,
    footer: 0,
  },
  flowInput: {
    width: 200,
    border: 1,
    header: 30,
    title: 44,
    outputY: 51,
    promptLine: 0,
    promptImages: 0,
    statusLine: 0,
  },
  finish: { title: 44 },
  port: { size: 12, handle: 20, highlight: 16 },
};

export function createNodeGeometry<B extends LayoutBlock>(
  graph: LayoutGraph<B>,
  dimensions: CanvasDimensions,
  facts: GeometryFacts<B> = {},
) {
  const rows = dimensions.block;
  const input = dimensions.flowInput;
  const ports = dimensionPorts(dimensions);
  const finishTitle = dimensions.finish.title;
  const baseHeight = (block: B) =>
    rows.border * 2 +
    rows.header +
    rows.title +
    rows.divider +
    rows.exitPaddingTop +
    rows.exitPaddingBottom +
    block.exits.length * rows.exitRow;
  const incoming = incomingIndex(graph);
  const bodyHeight = (block: B) =>
    blockHeightForIncomingFanIn(incoming.wires(block.id).length, ports, baseHeight(block));
  const blockWidth = (block: B) => facts.blockFrame?.(block)?.width ?? rows.width;
  const blockHeight = (block: B) => {
    const custom = facts.blockFrame?.(block);
    if (custom) {
      const fanIn = incoming.wires(block.id).length;
      const fanInHeight = custom.inputY + Math.max(0, fanIn - 1) * INCOMING_PORT_SPACING + 12;
      return Math.max(custom.height, fanInHeight);
    }
    return bodyHeight(block) + (facts.footerCount?.(block) ?? 0) * rows.footer;
  };
  const blockInputY = (block: B, index: number) =>
    (facts.blockFrame?.(block)?.inputY ?? ports.inputY) + index * INCOMING_PORT_SPACING;
  const blockExitY = (block: B, exitId: string, index: number) =>
    facts.blockFrame?.(block)?.exitY(exitId) ?? ports.firstExitY + index * ports.exitRow;
  const flowInputBox = {
    ...graph.flowInput.position,
    width: input.width,
    height:
      input.border * 2 +
      input.header +
      input.title +
      (facts.prompt === "images"
        ? input.promptImages
        : facts.prompt === "line"
          ? input.promptLine
          : 0) +
      (facts.flowInputStatus ? input.statusLine : 0),
  };
  const finishEndingY = ports.firstExitY - rows.title + finishTitle;
  const finishBox = {
    ...graph.finish.position,
    width: rows.width,
    height:
      rows.border * 2 +
      rows.header +
      finishTitle +
      rows.divider +
      rows.exitPaddingTop +
      rows.exitPaddingBottom +
      Math.max(1, graph.finish.endings.length) * rows.exitRow,
  };
  const reservedHeight = (block: B) => {
    if (facts.blockFrame?.(block)) return blockHeight(block);
    return Math.max(
      blockHeight(block),
      bodyHeight(block) + (facts.reservedFooterCount ?? 0) * rows.footer,
    );
  };
  return {
    ports,
    incoming,
    flowInputBox,
    finishBox,
    finishEndingY,
    blockWidth,
    blockHeight,
    blockInputY,
    blockExitY,
    reservedHeight,
    incomingGrowth: (block: B) =>
      facts.blockFrame?.(block) ? 0 : bodyHeight(block) - baseHeight(block),
  };
}

export function createFlowLayoutDimensions<B extends LayoutBlock>(
  graph: LayoutGraph<B>,
  dimensions: CanvasDimensions,
  facts: GeometryFacts<B> = {},
  labels = true,
): FlowLayoutDimensions<B> {
  const geometry = createNodeGeometry(graph, dimensions, facts);
  return {
    flowInput: {
      width: dimensions.flowInput.width,
      height: geometry.flowInputBox.height,
      outputY: dimensions.flowInput.outputY,
    },
    finish: { firstEndingY: geometry.finishEndingY },
    blockWidth: dimensions.block.width,
    blockHeight: geometry.reservedHeight,
    ...(facts.blockFrame && { blockFrame: facts.blockFrame }),
    ports: { ...geometry.ports, inputSpacing: INCOMING_PORT_SPACING },
    labels,
    labelSize: (text) => ({ width: text.length * 7 + 24, height: 22 }),
  };
}

const INCOMING_PORT_SPACING = 18;

export function incomingPortY(index: number, ports: BlockPorts) {
  return ports.inputY + index * INCOMING_PORT_SPACING;
}

function blockHeightForIncomingFanIn(fanIn: number, ports: BlockPorts, baseHeight: number) {
  return Math.max(baseHeight, incomingPortY(Math.max(0, fanIn - 1), ports) + 12);
}
