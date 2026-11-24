import type { ConnectionLiveMessage, T3Connection } from "@agent-easel/contracts";
import type { LiveScope } from "./owner.ts";

export const connectionScope: LiveScope<ConnectionLiveMessage, T3Connection> = {
  key: "connection",
  part: { kind: "connection" },
  snapshot: (message) => message.connection,
  apply: (connection, message) =>
    message._tag === "changed"
      ? message.connection
      : { ...connection, checkedAt: message.checkedAt },
};
