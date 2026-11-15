import type { FixtureModules } from "../server.ts";
import { FIXTURE_PREFIX, type FixtureHandle } from "./seam.ts";

type FixtureApp = { readonly baseUrl: string | undefined };

/** Every fixture module's actions, as journeys and support helpers call them. */
export type Fixture = {
  readonly [Name in keyof FixtureModules]: FixtureHandle<FixtureModules[Name]>;
};

/** Posts one fixture request and fails here, with the fixture's error, when it is rejected. */
async function post(app: FixtureApp, path: string, input?: unknown): Promise<unknown> {
  const response = await fetch(new URL(`${FIXTURE_PREFIX}/${path}`, app.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Fixture ${path} failed (${response.status}): ${text}`);
  return text === "" ? undefined : JSON.parse(text);
}

/** Returns every fixture module to its start-of-journey baseline. */
export const resetFixture = (app: FixtureApp) => post(app, "reset");

/**
 * The typed handles of the fixture `app` reaches. They are built from the module and action
 * names the caller uses, so journeys import only the fixture's types, never its runtime code.
 * `then` stays undefined so a handle is never mistaken for a promise.
 */
export function fixtureHandles(app: FixtureApp): Fixture {
  const named = (build: (name: string) => unknown) =>
    new Proxy(
      {},
      { get: (_, name) => (typeof name === "string" && name !== "then" ? build(name) : undefined) },
    );
  return named((module) =>
    named((action) => (input?: unknown) => post(app, `${module}/${action}`, input)),
  ) as Fixture;
}
