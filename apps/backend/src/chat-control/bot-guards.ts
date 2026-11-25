const TURN_WINDOW_MS = 5 * 60_000;
const MAX_BOT_TURNS = 3;
const RATE_LIMITS = {
  model: { count: 6, windowMs: 60_000 },
  proposal: { count: 2, windowMs: 5 * 60_000 },
} as const;

export const BOT_LOOP_REFUSAL =
  "AgentEasel paused bot requests in this thread after three consecutive bot turns. A human message or an accepted Start can clear the pause.";
export const BOT_RATE_REFUSAL =
  "AgentEasel paused requests from this bot because it reached a rate limit. Try again after the current limit window clears.";

export type BotGuardDecision = "allow" | "refuse" | "drop";

type Window = {
  readonly ends: number;
  count: number;
};

type TurnWindow = Window & {
  refused: boolean;
};

type RateWindows = {
  model?: Window;
  proposal?: Window;
  refused: boolean;
};

const active = (window: Window | undefined, at: number) =>
  window && window.ends > at ? window : undefined;

export function makeBotGuards() {
  const threads = new Map<string, TurnWindow>();
  const bots = new Map<string, RateWindows>();
  let pruneAt = 0;

  const prune = (at: number) => {
    if (at < pruneAt) return;
    for (const [id, window] of threads) {
      if (!active(window, at)) threads.delete(id);
    }
    for (const [id, windows] of bots) {
      if (!active(windows.model, at) && !active(windows.proposal, at)) bots.delete(id);
    }
    pruneAt = at + TURN_WINDOW_MS;
  };

  return {
    resetThread: (threadId: string) => threads.delete(threadId),
    checkThread(threadId: string, at: number): BotGuardDecision {
      const window = threads.get(threadId);
      if (!window || window.ends <= at || window.count < MAX_BOT_TURNS) return "allow";
      if (window.refused) return "drop";
      window.refused = true;
      return "refuse";
    },
    takeTurn(threadId: string, at: number) {
      const count = active(threads.get(threadId), at)?.count ?? 0;
      threads.set(threadId, { ends: at + TURN_WINDOW_MS, count: count + 1, refused: false });
    },
    rate(requesterId: string, at: number, use?: keyof typeof RATE_LIMITS): BotGuardDecision {
      prune(at);
      const windows: RateWindows = bots.get(requesterId) ?? { refused: false };
      const model = active(windows.model, at);
      const proposal = active(windows.proposal, at);
      const modelFull = model?.count === RATE_LIMITS.model.count;
      const proposalFull = proposal?.count === RATE_LIMITS.proposal.count;
      if (!modelFull && !proposalFull) windows.refused = false;
      if (windows.refused) return "drop";
      if (proposalFull || (modelFull && use !== "proposal")) {
        windows.refused = true;
        return "refuse";
      }
      if (use) {
        const window = use === "model" ? model : proposal;
        if (window) window.count += 1;
        else windows[use] = { ends: at + RATE_LIMITS[use].windowMs, count: 1 };
        bots.set(requesterId, windows);
      }
      return "allow";
    },
  };
}

export type BotGuards = ReturnType<typeof makeBotGuards>;
