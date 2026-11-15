import { fixtureHandles } from "./fixture/handle.ts";
import type { FixtureState } from "./fixture/scenarios.ts";

type FixtureApp = { baseUrl: string | undefined };

/** The fixture's own copy of the seeded scenario Runs, keyed by scenario. */
export const prepareScenarios = (app: FixtureApp) => fixtureHandles(app).scenarios.prepare();

/** Apply exactly the named module state to an existing Run, with caller-owned report content. */
export const applyRunState = (app: FixtureApp, id: string, state: FixtureState, message?: string) =>
  fixtureHandles(app).scenarios.transition({
    id,
    state,
    ...(message === undefined ? {} : { message }),
  });
