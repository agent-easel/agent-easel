import { isDeepStrictEqual } from "node:util";
import {
  controlledTitleModel,
  enableRunTitlesWithCheapModel,
  sha256Hex,
} from "../../../apps/backend/test/support/scenarios.ts";
import { requireSuccess } from "../../../scripts/dev/seed-support.ts";
import type { Host } from "./host.ts";
import type { scenariosFixture } from "./scenarios.ts";

/**
 * What T3 accepts and receives for Run images, and Run title generation. Created after the Run
 * scenarios module, whose scenario set gives the controlled provider its models.
 */
export function runImagesAndTitlesFixture(
  { factory, t3 }: Host,
  scenarios: Awaited<ReturnType<typeof scenariosFixture>>,
) {
  const providers = [...t3.controlledProviders];
  return {
    actions: {
      attachments({ supported }: { supported: boolean }) {
        t3.contract.support.attachmentLimit = supported ? 8 : null;
      },
      /** Each worker launch of Run `number` with its attachment names and uploaded digests. */
      launches: ({ number }: { number: number }) =>
        [...t3.threads.launches.values()]
          .filter(({ payload }) => payload.title.startsWith(`Factory #${number} · `))
          .map(({ payload }) => ({
            title: payload.title,
            attachments: (payload.attachments ?? []).map((attachment) => ({
              name: attachment.name,
              sha256: sha256Hex(t3.threads.uploads.get(attachment.id)!.data),
            })),
          })),
      /**
       * Generate Run titles is on with a cheap model that T3 withdraws before the next Start, so
       * that Start records the setting's diagnostic; the model stays chosen and stays withdrawn
       * until the reset.
       */
      async titleDiagnostic() {
        const withdraw = await enableRunTitlesWithCheapModel(factory, t3);
        withdraw();
        await scenarios.ensureRun(
          "run-title-diagnostic",
          "simple",
          "UI title diagnostic · Tidy the project picker",
        );
      },
    },
    async reset() {
      t3.contract.support.attachmentLimit = 8;
      if (
        providers.length !== t3.controlledProviders.length ||
        providers.some((provider, index) => provider !== t3.controlledProviders[index])
      )
        t3.controlledProviders.splice(0, t3.controlledProviders.length, ...providers);
      const setting = requireSuccess(await factory.getRunTitleSetting());
      if (setting.enabled || !isDeepStrictEqual(setting.model, controlledTitleModel))
        requireSuccess(
          await factory.updateRunTitleSetting({ enabled: false, model: controlledTitleModel }),
        );
    },
  };
}
