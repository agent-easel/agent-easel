/** The one place UI text formats recorded times: an ISO timestamp, or epoch milliseconds. */
type Instant = string | number;

const MINUTE = 60_000;

const elapsedMinutes = (at: string, now: number) =>
  Math.max(0, Math.floor((now - Date.parse(at)) / MINUTE));

/** Wall-clock time, "20:31", as the timeline and blocks show it. */
export function clockTime(at: Instant) {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

/** Wall-clock time to the second, "20:31:05", for short deadlines and checks. */
export function clockTimeWithSeconds(at: Instant) {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

/** "today 20:31" for today, otherwise "12 Oct 09:40". */
export function dayAndTime(at: Instant) {
  const date = new Date(at);
  const today = new Date().toDateString() === date.toDateString();
  const day = today ? "today" : date.toLocaleDateString([], { day: "numeric", month: "short" });
  return `${day} ${clockTime(at)}`;
}

/** The full local date and time, for tooltips and accessible names. */
export function fullDateTime(at: Instant) {
  return new Date(at).toLocaleString();
}

/** "just now", then "12 min ago", "3 h ago" or "2 d ago", rounded down. */
export function timeAgo(at: string, now = Date.now()) {
  const minutes = elapsedMinutes(at, now);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** The compact age of a sidebar row: "now", then "12m", "3h" or "2d", rounded down. */
export function compactAge(at: string, now = Date.now()) {
  const minutes = elapsedMinutes(at, now);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

/** "today", "yesterday", or the local date for older days. */
export function relativeDay(at: string, now = Date.now()) {
  const days = Math.round(
    (new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000,
  );
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return new Date(at).toLocaleDateString();
}
