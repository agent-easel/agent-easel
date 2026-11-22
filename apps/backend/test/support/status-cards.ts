import { placingGraph, savedFlow } from "./subflow.ts";
import {
  agentBlock,
  connection,
  flowInput,
  humanStep,
  joinBesideEndingFlow,
  launchedWorkers,
  workerHandle,
  type ReadyFlowShape,
} from "./scenarios.ts";
import { assert } from "@effect/vitest";
import type { DiscordSettings } from "@t3-factory/contracts";
import type { Factory } from "../../src/index.ts";
import {
  besidesReports,
  clicked,
  isStatusCard,
  proposedStart,
  START_PROMPT,
  startCall,
  type startingWorld,
} from "./chat-actions.ts";
import { discordSettingsWhen } from "./chat-control.ts";
import { unproven, type ControlledDiscord, type CreatedMessage } from "./controlled-discord.ts";
import type { RunDetail } from "@t3-factory/contracts";

type World = Awaited<ReturnType<typeof startingWorld>>;

/**
 * Starts a Run through a requester's confirmation in `THREAD` and waits for its status card.
 * `ordinal` numbers Starts in one world (1, 2, …): each adds a review of two messages and a card,
 * and uses its own invocation and click IDs. Returns the Run, its launched worker and
 * the card message.
 */
export async function chatStartedRun(world: World, ordinal = 1, prompt = START_PROMPT) {
  const before = besidesReports(world.discord).length;
  const button = await proposedStart(
    world,
    `60000000000000000${ordinal}`,
    before + 2,
    startCall(world, prompt),
    `start this:\n${prompt}`,
  );
  await clicked(world.discord, button, `61000000000000000${ordinal}`, ordinal);
  await world.discord.createdWhere(isStatusCard, ordinal);
  const card = world.discord.created.filter(isStatusCard)[ordinal - 1]!;
  const navigation = await world.factory.listRunNavigation();
  assert(navigation.ok, JSON.stringify(navigation));
  const runId = navigation.value.find((entry) => entry.number === ordinal)!.id;
  const { workers } = await launchedWorkers(world.world, runId);
  return { runId, worker: workers[0]!, card };
}

/** Resolves with the message once Discord shows `shown` (a card or notice) matching `pattern`. */
export async function messageShows(
  discord: ControlledDiscord,
  shown: CreatedMessage,
  pattern: RegExp,
) {
  await discord.messagesWhen((messages) =>
    messages.some((message) => message.id === shown.id && pattern.test(message.content)),
  );
  return discord.created.find((message) => message.id === shown.id)!;
}

/** The Discord settings once a status card delivery problem in `state` is listed. */
export const cardProblem = (
  factory: Pick<Factory, "getDiscordSettings">,
  state: DiscordSettings["delivery"]["problems"][number]["state"],
) =>
  discordSettingsWhen(factory, (settings) =>
    settings.delivery.problems.some(
      (problem) => problem.purpose === "status-card" && problem.state === state,
    ),
  );

export async function unknownStatusCard(world: World) {
  const button = await proposedStart(world, "600000000000000001", 2);
  world.discord.faultMessages(...unproven("lost"));
  await clicked(world.discord, button, "610000000000000001", 1);
  const [problem] = (await cardProblem(world.factory, "unknown")).delivery.problems;
  return problem!;
}

export const nestedJoinCardFlow: ReadyFlowShape = async (context) => {
  const { agent, flow: child } = await joinBesideEndingFlow(context);
  const graph = placingGraph(child.id);
  const flow = await savedFlow(context.factory, {
    name: "Review panel",
    graph: {
      ...graph,
      connections: graph.connections.map((wire) => ({ ...wire, exitId: "delivered" })),
    },
  });
  return { agent, flow };
};

export const queuedJoinCardFlow =
  (ancestor: boolean): ReadyFlowShape =>
  async (context) => {
    const { agent, flow: child } = await (ancestor ? nestedJoinCardFlow : joinBesideEndingFlow)(
      context,
    );
    const graph = placingGraph(child.id);
    const flow = await savedFlow(context.factory, {
      name: "Queued reviews",
      graph: {
        flowInput: flowInput("inner-0", "queue"),
        blocks: [
          ...graph.blocks,
          agentBlock("queue", "Queue another review", agent.id),
          humanStep("review", "Decision"),
        ],
        connections: [
          connection("queue", "done", "inner-0"),
          connection("inner-0", ancestor ? "done" : "delivered", "review"),
        ],
      },
    });
    return { agent, flow };
  };

export function childWorker(world: World, run: RunDetail, templateId: string) {
  const block = run.blocks.find((item) => item.templateBlockId === templateId)!;
  return workerHandle(world.world, run, block.blockId);
}
