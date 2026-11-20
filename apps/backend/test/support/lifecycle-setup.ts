import type { ControlledT3 } from "./controlled-t3.ts";

export function restoreLaunches(
  t3: ControlledT3,
  entries: Iterable<[string, Parameters<ControlledT3["threads"]["launches"]["set"]>[1]]>,
) {
  for (const [key, value] of entries) t3.threads.launches.set(key, value);
}
