import {
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
} from "react";
import type { Rect } from "./canvas-culling.ts";
import type { CanvasView } from "./canvas-viewport.ts";
import type { createCanvasGeometry } from "./flow-geometry.ts";
import { sameNode, type CanvasNode } from "./flow-graph.ts";

const POINTER_LEAVE_GRACE_MS = 80;

type PreviewTarget = { readonly scope: string } & (
  | { readonly kind: "block"; readonly node: CanvasNode }
  | { readonly kind: "wire"; readonly key: string }
);

export type PreviewSource = Extract<PreviewTarget, { kind: "block" }>;

type Preview = { readonly target: PreviewTarget; readonly via: "pointer" | "keyboard" };

function targetOf(layer: HTMLElement, hit: EventTarget | null): PreviewTarget | null {
  if (!(hit instanceof Element) || !layer.contains(hit)) return null;
  const scope = hit.closest<HTMLElement>("[data-canvas-scope]")?.dataset.canvasScope ?? "";
  const card = hit.closest<HTMLElement>("[data-block-id], [data-flow-input], [data-finish]");
  if (card) {
    if (card.hasAttribute("data-finish")) return null;
    const { blockId } = card.dataset;
    const node: CanvasNode =
      blockId === undefined ? { kind: "flow-input" } : { kind: "block", blockId };
    return { scope, kind: "block", node };
  }
  const key = hit.closest("[data-wire-key]")?.getAttribute("data-wire-key");
  return key ? { scope, kind: "wire", key } : null;
}

function sameTarget(a: PreviewTarget | null, b: PreviewTarget | null) {
  if (!a || !b) return a === b;
  if (a.scope !== b.scope) return false;
  if (a.kind === "wire") return b.kind === "wire" && a.key === b.key;
  return b.kind === "block" && sameNode(a.node, b.node);
}

function samePreview(a: Preview | null, b: Preview | null) {
  return a?.via === b?.via && sameTarget(a?.target ?? null, b?.target ?? null);
}

export function useConnectionPreview({
  owner,
  view,
  geometry,
  area,
}: {
  owner: string | null;
  view: CanvasView;
  geometry: ReturnType<typeof createCanvasGeometry>;
  area: Rect | null;
}) {
  const [state, setState] = useState<{ owner: string | null; preview: Preview | null }>({
    owner,
    preview: null,
  });
  if (state.owner !== owner) setState({ owner, preview: null });
  const preview = owner !== null && state.owner === owner ? state.preview : null;
  const layer = useRef<HTMLElement | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const leave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function apply(next: Preview | null) {
    clearTimeout(leave.current);
    leave.current = undefined;
    setState((current) =>
      current.owner !== owner || samePreview(current.preview, next)
        ? current
        : { owner, preview: next },
    );
  }

  function releasePointer() {
    if (preview?.via !== "pointer" || leave.current !== undefined) return;
    leave.current = setTimeout(() => apply(null), POINTER_LEAVE_GRACE_MS);
  }

  useLayoutEffect(() => () => clearTimeout(leave.current), []);
  useLayoutEffect(() => {
    clearTimeout(leave.current);
    leave.current = undefined;
  }, [owner]);

  const recheck = useEffectEvent(() => {
    if (!preview || !layer.current) return;
    const { ownerDocument } = layer.current;
    const hit =
      preview.via === "keyboard"
        ? ownerDocument.activeElement
        : pointer.current && ownerDocument.elementFromPoint(pointer.current.x, pointer.current.y);
    if (!sameTarget(targetOf(layer.current, hit), preview.target)) apply(null);
  });
  useLayoutEffect(() => recheck(), [view, geometry, area]);

  function point(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse") {
      if (event.type === "pointerdown") apply(null);
      return;
    }
    layer.current = event.currentTarget;
    pointer.current = { x: event.clientX, y: event.clientY };
    const hit = event.currentTarget.ownerDocument.elementFromPoint(event.clientX, event.clientY);
    const target = targetOf(event.currentTarget, hit);
    if (target) apply({ target, via: "pointer" });
    else if (preview?.via === "keyboard" || event.type === "pointerdown") apply(null);
    else releasePointer();
  }

  const handlers = {
    onPointerMove: point,
    onPointerDownCapture: point,
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== "mouse") return;
      pointer.current = { x: event.clientX, y: event.clientY };
      releasePointer();
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      layer.current = event.currentTarget;
      const target = targetOf(event.currentTarget, event.target);
      if (event.target.matches(":focus-visible"))
        apply(target ? { target, via: "keyboard" } : null);
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (preview?.via !== "keyboard") return;
      const next = targetOf(event.currentTarget, event.relatedTarget);
      if (!sameTarget(next, preview.target)) apply(null);
    },
  };
  return { target: preview?.target ?? null, handlers: owner === null ? {} : handlers };
}
