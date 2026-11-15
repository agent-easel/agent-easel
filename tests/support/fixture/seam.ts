/** Fixture actions and browser navigations live under this prefix; Factory never serves it. */
export const FIXTURE_PREFIX = "/__fixture";

/** Marks a browser as remote; the fixture relays its traffic to the current target server. */
export const remoteBrowserPath = `${FIXTURE_PREFIX}/remote-browser`;

/** Opens `next` as a remote browser profile the target server already approved. */
export const approvedBrowserPath = (next: string) =>
  `${FIXTURE_PREFIX}/approved-browser?next=${encodeURIComponent(next)}`;

/** One fixture action: an optional JSON input from the caller, and a JSON answer or nothing. */
type FixtureAction = (input: never) => unknown;

/** One concern's controlled world in the fixture process. */
export interface FixtureModule<
  Actions extends Record<string, FixtureAction> = Record<string, FixtureAction>,
> {
  /** Served as `POST <prefix>/<module>/<action>` with the input as the JSON body. */
  readonly actions: Actions;
  /**
   * Returns this module's state to the start-of-journey baseline. It compares the live state
   * with the baseline, since journeys also change it through the UI.
   */
  reset(): Promise<void> | void;
}

/** What a journey calls for one module: every action, answering once the fixture accepted it. */
export type FixtureHandle<Module extends FixtureModule> = {
  readonly [Name in keyof Module["actions"]]: Module["actions"][Name] extends (
    ...input: infer Input
  ) => infer Output
    ? (...input: Input) => Promise<Awaited<Output>>
    : never;
};
