import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { reaches, type Rect } from "../canvas-culling.ts";
import type { WireRoute } from "../flow-layout-elk.ts";

type Point = { x: number; y: number };

function chipPosition(
  path: SVGPathElement,
  returnMidpoint: Point | undefined,
  visible: Rect,
  obstacles: readonly Rect[],
  width: number,
  height: number,
  scale: number,
) {
  const length = path.getTotalLength();
  if (!length) return null;
  const preferred = returnMidpoint ?? path.getPointAtLength(length / 2);
  const onScreen = ({ x, y }: Point) => reaches(visible, { x, y, width: 0, height: 0 });
  const fits = ({ x, y }: Point) => {
    const box = { x: x - width / 2, y: y - height / 2, width, height };
    return (
      box.x >= visible.x &&
      box.y >= visible.y &&
      box.x + width <= visible.x + visible.width &&
      box.y + height <= visible.y + visible.height &&
      obstacles.every((obstacle) => !reaches(box, obstacle))
    );
  };
  if (fits(preferred)) return preferred;

  const steps = Math.min(2048, Math.ceil((length * scale) / 2));
  const points: Point[] = [];
  for (let step = 0; step <= steps; step++) {
    const point = path.getPointAtLength((step / steps) * length);
    if (onScreen(point)) points.push(point);
  }
  const aim = onScreen(preferred) ? preferred : points[Math.floor(points.length / 2)];
  if (!aim) return null;
  const distance = (point: Point) => Math.hypot(point.x - aim.x, point.y - aim.y);
  points.sort((a, b) => distance(a) - distance(b));
  const direct = points.find(fits);
  if (direct) return direct;

  for (const point of [aim, ...points]) {
    const column = obstacles.filter(
      (box) => point.x + width / 2 >= box.x && point.x - width / 2 <= box.x + box.width,
    );
    const lifted = column
      .flatMap((box) => [
        { x: point.x, y: box.y - height / 2 - 1 / scale },
        { x: point.x, y: box.y + box.height + height / 2 + 1 / scale },
      ])
      .sort(
        (a, b) =>
          Number(a.y > point.y) - Number(b.y > point.y) ||
          Math.abs(a.y - point.y) - Math.abs(b.y - point.y),
      )
      .find(fits);
    if (lifted) return lifted;
  }
  return null;
}

export function WireLabelChip({
  label,
  route,
  scale,
  visible,
  obstacles,
}: {
  label: { text: string; struck: boolean };
  route: WireRoute;
  scale: number;
  visible: Rect;
  obstacles: readonly Rect[];
}) {
  const path = useRef<SVGPathElement>(null);
  const chip = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = chip.current;
    const track = path.current;
    if (!element || !track) return;
    const place = () => {
      const point = chipPosition(
        track,
        route.returnMidpoint,
        visible,
        obstacles,
        element.offsetWidth / scale,
        element.offsetHeight / scale,
        scale,
      );
      element.style.visibility = point ? "visible" : "hidden";
      if (point) {
        element.style.left = `${point.x}px`;
        element.style.top = `${point.y}px`;
      }
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    return () => observer.disconnect();
  }, [route, scale, visible, obstacles]);
  return (
    <>
      <svg aria-hidden className="pointer-events-none absolute size-0">
        <path ref={path} d={route.d} />
      </svg>
      <span
        ref={chip}
        data-wire-label
        className={cn(
          "pointer-events-none invisible absolute z-20 w-max max-w-40 origin-top-left truncate rounded-full bg-foreground px-2 py-0.5 text-xs leading-4 font-semibold text-background",
          label.struck && "line-through",
        )}
        style={{ transform: `scale(${1 / scale}) translate(-50%, -50%)` }}
      >
        {label.text}
      </span>
    </>
  );
}
