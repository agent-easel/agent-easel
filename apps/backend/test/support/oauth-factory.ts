import { assert, expect, type TestContext } from "@effect/vitest";
import { dirname, join } from "node:path";
import { makeLiveT3 } from "../../src/index.ts";
import { factoryHarness } from "./factory.ts";
import { oauthT3 } from "./oauth-t3.ts";

export function liveT3(credentialsDirectory: string, onUrl: (url: string) => void) {
  return makeLiveT3({
    credentialsDirectory,
    callbackPort: 0,
    openBrowser: async (url) => {
      onUrl(url);
    },
  });
}

export async function openOAuthFactory(context: TestContext) {
  const harness = await factoryHarness(context);
  const external = await oauthT3();
  context.onTestFinished(() => external.close());
  const credentialsDirectory = join(dirname(harness.databasePath), "credentials");
  let authorizationUrl = "";
  const openedUrls: string[] = [];
  let browserFails = false;
  const live = liveT3(credentialsDirectory, (url) => {
    if (browserFails) throw new Error("No browser on the backend host");
    authorizationUrl = url;
    openedUrls.push(url);
  });
  // Deliver consent immediately after an inspection observed pending approval. This
  // exercises the adapter boundary between that stale observation and reopening.
  let approveAfterInspection = false;
  const inspect = live.contract.inspect.bind(live.contract);
  live.contract.inspect = async (target) => {
    const observation = await inspect(target);
    if (approveAfterInspection && observation.reason === "approval-pending") {
      approveAfterInspection = false;
      const reply = await fetch(external.approvalUrl(authorizationUrl));
      assert(reply.ok);
    }
    return observation;
  };
  const factory = await harness.open({ t3: live });
  await factory.configureConnection({ endpoint: external.endpoint });
  return {
    harness,
    external,
    factory,
    credentialsDirectory,
    approveOnNextPendingInspection: () => {
      approveAfterInspection = true;
    },
    getAuthorizationUrl: () => authorizationUrl,
    /** Every page the host browser was asked to open, in order. */
    openedUrls,
    /** Whether the backend host's browser can be opened. */
    hostBrowserOpens: (opens: boolean) => {
      browserFails = !opens;
    },
  };
}

/** The backend restarts on the same home and credentials; its host browser opens. */
export async function restartedOAuthFactory(
  { harness, factory, credentialsDirectory }: Awaited<ReturnType<typeof openOAuthFactory>>,
  onUrl: (url: string) => void = () => {},
) {
  await factory.close();
  return harness.open({ t3: liveT3(credentialsDirectory, onUrl) });
}

/** Approval waits in the host's browser, and reopening its page failed to open that browser. */
export async function failedReopen(context: TestContext) {
  const opened = await openOAuthFactory(context);
  assert((await opened.factory.authorizeConnection()).ok);
  opened.hostBrowserOpens(false);
  const reopened = await opened.factory.openConnectionAuthorization();
  assert(reopened.ok);
  expect(reopened.value.authorizationOpenFailed).toBe(true);
  return opened;
}
