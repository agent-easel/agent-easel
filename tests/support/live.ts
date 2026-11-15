import { fixtureHandles } from "./fixture/handle.ts";
import type { FixtureState, ScenarioFlow } from "./fixture/scenarios.ts";

type FixtureApp = { baseUrl: string | undefined };

/** Starts this key once per journey attempt, in `flow` and the current authorization context. */
export const liveRun = async (app: FixtureApp, key: string, flow: ScenarioFlow = "simple") =>
  (await fixtureHandles(app).scenarios.ensure({ key, flow })).id;

/** A journey supplies module state names, optionally with its own report content. */
export async function liveStates(
  app: FixtureApp,
  key: string,
  states: readonly FixtureState[],
  message?: string,
) {
  for (const state of states)
    await fixtureHandles(app).scenarios.transition({
      key,
      state,
      ...(message === undefined ? {} : { message }),
    });
}

export const resetBrowserRequests = (app: FixtureApp) => fixtureHandles(app).live.resetRequests();

/** HTTP requests browsers sent through the fixture since the last reset, as `METHOD /path`. */
export const browserRequests = (app: FixtureApp) => fixtureHandles(app).live.requests();

/** Live sockets the fixture currently relays per surface. */
export const openLiveSockets = (app: FixtureApp) => fixtureHandles(app).live.sockets();

/** Holds back each newly opened live socket's server frames for `ms`. */
export const delayLiveSnapshots = (app: FixtureApp, ms: number) =>
  fixtureHandles(app).live.snapshotDelay({ ms });
