import { createContext, useContext } from "react";

/** Provided by the client gate once product screens may mount. */
export const ScopeContext = createContext<"host" | "remote">("host");

/** `host`: the owner's local panel. `remote`: an approved client without host setup controls. */
export const useClientScope = () => useContext(ScopeContext);

/**
 * The identity of the Factory server that confirmed this client's access, or null from a
 * server that declares none. Cached state of another server must never be shown.
 */
export const ServerIdContext = createContext<string | null>(null);
export const useServerId = () => useContext(ServerIdContext);
