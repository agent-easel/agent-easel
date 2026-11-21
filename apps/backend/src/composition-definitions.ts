import type * as SqlClient from "effect/sql/SqlClient";
import * as Effect from "effect/Effect";
import {
  agentCaptureBytes,
  readinessAgent,
  type CompositionDefinitions,
} from "@t3-factory/domain-validation";
import { readCurrentAgents, readFormerExitNames } from "./agent-revisions.ts";
import { readCurrentFlows } from "./flow-revisions.ts";

export const readCompositionDefinitions = Effect.fnUntraced(function* (sql: SqlClient.SqlClient) {
  const agents = yield* readCurrentAgents(sql);
  const formerExitNames = yield* readFormerExitNames(sql);
  const flows = yield* readCurrentFlows(sql);
  const saved = new Map(agents.map((agent) => [agent.id, agent]));
  const bytes = new Map<string, number>();
  return {
    agents: agents.map((agent) =>
      readinessAgent(agent, formerExitNames.get(agent.id) ?? new Map()),
    ),
    flows: new Map(flows.map((flow) => [flow.id, flow])),
    agentBytes: (id: string) => {
      const known = bytes.get(id);
      if (known !== undefined) return known;
      const counted = agentCaptureBytes(saved.get(id)!);
      bytes.set(id, counted);
      return counted;
    },
  } satisfies CompositionDefinitions;
});
