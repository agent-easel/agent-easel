const ellipsis = "…";

/**
 * The name a menu row shows. A name that fits is unchanged. Otherwise it ends with an ellipsis,
 * unless that would make two names in the menu look the same: those keep a distinguishing ending.
 */
export function menuLabel(
  name: string,
  peers: readonly string[],
  maxWidth: number,
  measure: (text: string) => number,
): string {
  if (maxWidth <= 0 || measure(name) <= maxWidth) return name;
  const ended = fitEnd(name, maxWidth, measure);
  const collides = peers.some(
    (peer) =>
      peer !== name && measure(peer) > maxWidth && fitEnd(peer, maxWidth, measure) === ended,
  );
  if (!collides) return ended;
  return fitMiddle(
    name,
    peers.filter(
      (peer) =>
        peer !== name && measure(peer) > maxWidth && fitEnd(peer, maxWidth, measure) === ended,
    ),
    maxWidth,
    measure,
  );
}

function fitEnd(text: string, maxWidth: number, measure: (text: string) => number) {
  return fit(text.length, maxWidth, measure, (count) => text.slice(0, count) + ellipsis);
}

/** Keeps the shortest ending that no colliding name shares, then as much of the start as fits. */
function fitMiddle(
  name: string,
  others: readonly string[],
  maxWidth: number,
  measure: (text: string) => number,
) {
  let tail = name;
  for (let length = 1; length <= name.length; length += 1) {
    const ending = name.slice(-length);
    if (others.every((other) => other.slice(-length) !== ending)) {
      tail = ending;
      break;
    }
  }
  if (measure(ellipsis + tail) > maxWidth)
    return fit(
      tail.length,
      maxWidth,
      measure,
      (count) => ellipsis + tail.slice(tail.length - count),
    );
  const headRoom = name.length - tail.length;
  const head = fit(headRoom, maxWidth, measure, (count) => name.slice(0, count) + ellipsis + tail);
  const count = head.endsWith(ellipsis + tail) ? head.length - ellipsis.length - tail.length : 0;
  return name.slice(0, count) + ellipsis + tail;
}

/** The longest count from 0 to `limit` whose text fits, or the ellipsis alone when nothing else does. */
function fit(
  limit: number,
  maxWidth: number,
  measure: (text: string) => number,
  text: (count: number) => string,
) {
  if (measure(ellipsis) > maxWidth) return ellipsis;
  let low = 0;
  let high = limit;
  let best = ellipsis;
  while (low <= high) {
    const count = Math.floor((low + high) / 2);
    const candidate = text(count);
    if (measure(candidate) <= maxWidth) {
      best = candidate;
      low = count + 1;
    } else {
      high = count - 1;
    }
  }
  return best;
}
