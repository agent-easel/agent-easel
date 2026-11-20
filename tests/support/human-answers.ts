import { expect, type App, type Locator, type Screen } from "e2e";
import type { Browser } from "@e2e-dev/web";
import { liveRun } from "./live.ts";
import { applyRunState, prepareScenario } from "./scenarios.ts";

/** Chooses `decision` from the Decision menu of the Human answer form `answer`. */
export async function chooseDecision(screen: Screen, answer: Locator, decision: string) {
  await answer.getByRole("combobox", /^Decision/).tap();
  await screen
    .getByRole("listbox", "Decision", { exact: true })
    .getByRole("option", decision, { exact: true })
    .tap();
}

/**
 * Journey Run `key` of `flow`, whose Implement change `result` reached First review, where a person
 * approved it with a long Markdown answer by `decision`; open on its Run page.
 */
export async function approveFirstReviewAtLength(
  { app, screen, browser }: { app: App; screen: Screen; browser: Browser },
  key: string,
  flow: "answerRelay" | "answerCondition" | "answerBesideResult",
  decision: string,
  result = "The picker spacing is tidy; ready for review.",
) {
  await browser.setViewport({ width: 1600, height: 1000 });
  const runId = await liveRun(app, key, flow);
  await applyRunState(app, runId, "result reported", result);
  await app.open(`/runs/${runId}`);
  const review = screen
    .getByRole("complementary", "Run inspector")
    .getByRole("form", "Answer First review", { exact: true });
  await chooseDecision(screen, review, decision);
  await review
    .getByRole("textbox", "Response", { exact: true })
    .fill(
      [
        "## First review notes",
        "",
        "The spacing change reads well in both themes.",
        "",
        "- Row height matches the sidebar.",
        "- Long project names truncate with an ellipsis.",
        "- Focus rings stay inside the popover.",
        "",
        "### For sign-off",
        "",
        "Check the picker once more on the narrow window before release.",
        "Nothing else blocks this change.",
      ].join("\n"),
    );
  await review.getByRole("button", "Submit answer", { exact: true }).tap();
  return runId;
}

/** The answer form of the Final sign-off step the relayed answer reached. */
export const finalSignoff = (screen: Screen) =>
  screen
    .getByRole("complementary", "Run inspector")
    .getByRole("form", "Answer Final sign-off", { exact: true });

/** The open Final sign-off context reader names First review, with no Agent or visit, as its author. */
export async function expectWrittenByFirstReview(screen: Screen) {
  const reader = screen.getByRole("dialog", "Final sign-off · context", { exact: true });
  await expect(reader).toContainText(/From First review · \d\d:\d\d/);
  await expect(reader.getByRole("heading", "First review notes", { exact: true })).toBeVisible();
  await expect(reader).not.toContainText("Implement change");
  await expect(reader).not.toContainText("Visit");
}

/** Captures `name` once the open reader's entrance animation has finished. */
export async function readerScreenshot(app: App, browser: Browser, name: string) {
  await browser.evaluate(
    "Promise.allSettled(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished)).then(() => null)",
  );
  await app.screenshot(name);
}

/**
 * Opens the Run whose Code review and Accessibility review each reported the same long "Shared
 * review" through the Condition Route the reviews to two pending Your decision occurrences.
 * `readContext` opens the reader of the occurrence whose card names `source` and returns it.
 */
export async function openIdenticalReviewsThroughCondition({
  app,
  screen,
  browser,
}: {
  app: App;
  screen: Screen;
  browser: Browser;
}) {
  await browser.setViewport({ width: 1600, height: 1000 });
  const run = await prepareScenario(app, "condition-identical-reviews");
  await app.open(`/runs/${run.id}`);
  const readContext = async (source: string) => {
    await screen
      .getByRole("complementary", "Run inspector")
      .getByRole("article", `Needs input · Your decision · From ${source}`, { exact: true })
      .getByRole("button", "Read full context", { exact: true })
      .tap();
    return screen.getByRole("dialog", "Your decision · context", { exact: true });
  };
  return { readContext };
}
