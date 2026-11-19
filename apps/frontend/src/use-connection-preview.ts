import { useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent } from "react";
import { sameNode, type CanvasNode } from "./flow-graph.ts";

/** The card whose outgoing connections are previewed, and the input that chose it. */
type Preview = { readonly source: CanvasNode; readonly via: "pointer" | "keyboard" };

/** The canvas node a target belongs to; content portalled out of the layer belongs to none. */
function cardOf(layer: HTMLElement, target: EventTarget | null): CanvasNode | null {
  if (!(target instanceof Element) || !layer.contains(target)) return null;
  const card = target.closest<HTMLElement>("[data-block-id], [data-flow-input]");
  if (!card) return null;
  const { blockId } = card.dataset;
  return blockId === undefined ? { kind: "flow-input" } : { kind: "block", blockId };
}

function samePreview(a: Preview | null, b: Preview | null) {
  return a?.via === b?.via && sameNode(a?.source ?? null, b?.source ?? null);
}

/**
 * The card whose outgoing connections a read-only canvas emphasizes: the one under a mouse or
 * trackpad pointer, or the one holding keyboard-visible focus, whichever acted last. Touch never
 * previews. The preview clears when its card loses the pointer or focus, when the view moves the
 * card out from under a resting pointer, and when the canvas is covered or shows another scope.
 */
export function useConnectionPreview({
  enabled,
  scope,
  shown,
}: {
  enabled: boolean;
  scope: string | null;
  shown: boolean;
}) {
  const owner = shown ? scope : null;
  const [state, setState] = useState<{ owner: string | null; preview: Preview | null }>({
    owner,
    preview: null,
  });
  if (state.owner !== owner) setState({ owner, preview: null });
  const preview = state.owner === owner ? state.preview : null;
  /** The resting mouse position, and the layer it last moved over. */
  const pointer = useRef<{ x: number; y: number; layer: HTMLElement } | null>(null);
  const update = (next: (current: Preview | null) => Preview | null) =>
    setState((current) => {
      const preview = next(current.preview);
      return samePreview(preview, current.preview) ? current : { owner: current.owner, preview };
    });

  // Pan, zoom and Follow active move the layer without pointer events, so hit-test the resting
  // pointer after each render.
  useLayoutEffect(() => {
    if (preview?.via !== "pointer" || !pointer.current) return;
    const { x, y, layer } = pointer.current;
    const under = cardOf(layer, document.elementFromPoint(x, y));
    if (!sameNode(under, preview.source)) update(() => null);
  });

  const releasePointer = (current: Preview | null) => (current?.via === "pointer" ? null : current);
  const point = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse") return;
    pointer.current = { x: event.clientX, y: event.clientY, layer: event.currentTarget };
    const source = cardOf(event.currentTarget, event.target);
    update((current) => (source ? { source, via: "pointer" } : releasePointer(current)));
  };
  const handlers = {
    onPointerMove: point,
    // A press without movement also takes over from a keyboard preview; capturing keeps the
    // layer's own pointerdown (pan) untouched.
    onPointerDownCapture: point,
    onPointerLeave: () => update(releasePointer),
    onFocus: (event: FocusEvent<HTMLElement>) => {
      const source = cardOf(event.currentTarget, event.target);
      if (source && event.target.matches(":focus-visible"))
        update(() => ({ source, via: "keyboard" }));
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      const next = cardOf(event.currentTarget, event.relatedTarget);
      update((current) =>
        current?.via === "keyboard" && !sameNode(next, current.source) ? null : current,
      );
    },
  };
  return { source: preview?.source ?? null, handlers: enabled ? handlers : {} };
}
