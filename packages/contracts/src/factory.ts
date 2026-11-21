import { agentOperations } from "./agent.ts";
import { flowOperations } from "./flow.ts";
import { definitionImportOperations } from "./portable-document.ts";
import { projectOperations, projectServerOperations } from "./project.ts";
import { connectionOperations } from "./connection.ts";
import type { AppearanceSource } from "./appearance.ts";
import { runOperations } from "./run.ts";
import { privacyOperations } from "./privacy.ts";
import { chatControlOperations } from "./chat-control.ts";
import {
  type ClientAccessState,
  type FactoryClient,
  clientAccessOperations,
  clientAccessServerOperations,
} from "./client-access.ts";
import type { FacadeOperations } from "./operation.ts";
import type { Result } from "./result.ts";
import { serverUpdateOperations } from "./update.ts";
import { triggerOperations } from "./trigger.ts";

/** Every HTTP operation, including those answered by the server around the facade. */
export const httpOperations = {
  ...agentOperations,
  ...flowOperations,
  ...definitionImportOperations,
  ...projectOperations,
  ...projectServerOperations,
  ...connectionOperations,
  ...runOperations,
  ...privacyOperations,
  ...chatControlOperations,
  ...triggerOperations,
  ...clientAccessOperations,
  ...clientAccessServerOperations,
  ...serverUpdateOperations,
};

/** The Factory facade: derived from the operation definitions, plus operations HTTP does not reach. */
export interface FactoryOperations extends FacadeOperations<
  typeof agentOperations &
    typeof flowOperations &
    typeof definitionImportOperations &
    typeof projectOperations &
    typeof connectionOperations &
    typeof runOperations &
    typeof chatControlOperations &
    typeof triggerOperations &
    typeof clientAccessOperations
> {
  reconcileRuns(): Promise<Result<void>>;
  getClientAccess(credential: string): Promise<Result<ClientAccessState>>;
  /** The identity this Factory's data home was created with; it never changes. */
  getServerId(): Promise<Result<string>>;
  /** The source theme colors currently come from; null while there is no authorized T3 connection environment. */
  getAppearanceSource(): Promise<Result<AppearanceSource | null>>;
  authenticateClient(credential: string): Promise<Result<FactoryClient>>;
}
