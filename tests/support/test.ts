import { test as web } from "@e2e-dev/web";
import { fixtureHandles, resetFixture, type Fixture } from "./fixture/handle.ts";

/**
 * Every journey's `test`: the fixture returns to its start-of-journey baseline before the
 * journey's hooks run, and `fixture` holds its typed handles.
 */
export const test = web.extend<{ fixture: Fixture }>({
  fixture: async ({ app }, use) => {
    await resetFixture(app);
    await use(fixtureHandles(app));
  },
});

export const { beforeEach, afterEach } = test;
