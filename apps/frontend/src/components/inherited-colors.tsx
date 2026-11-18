import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AppearancePresentation, T3Appearance } from "@t3-factory/contracts";
import { applyInheritedColors } from "../appearance.ts";
import { useAppearanceSource, useServerId } from "../client-scope.ts";
import {
  cachedColors,
  followColors,
  type FollowedColors,
  forgetColors,
  profileStorage,
  rememberColors,
} from "../inherited-colors-cache.ts";
import { useLiveAppearance } from "../live/live-connection.ts";

const ThemeColorsContext = createContext<{
  status: T3Appearance | null;
  presentation: AppearancePresentation | null;
}>({ status: null, presentation: null });

export const useThemeColors = () => useContext(ThemeColorsContext);

/**
 * Shows one server's theme colors while product screens are mounted: its cached snapshot of
 * the source the server declared at the access check until live delivery answers, then exactly
 * what the server publishes. A value live delivery kept from before a reconnect is not trusted
 * until the current subscription confirms it, and colors already shown or still held by live
 * delivery are dropped when a later access check declares another source, so a replaced server
 * or source cannot keep or bring back an old palette.
 */
function FollowInheritedColors({ serverId, children }: { serverId: string; children: ReactNode }) {
  const live = useLiveAppearance();
  const source = useAppearanceSource();
  const [followed, setFollowed] = useState<FollowedColors>(() => ({
    declared: source,
    cached: cachedColors(profileStorage(), serverId, source),
    published: null,
    refused: null,
  }));
  // Every access check declares the server's source again, also while this client stays
  // mounted through a reconnect, so the colors are followed during render.
  const current = followColors(followed, source, live);
  if (current !== followed) setFollowed(current);
  const { published } = current;
  const presentation = published ? published.presentation : current.cached;
  useEffect(() => {
    if (!published) return;
    if (published.presentation) rememberColors(profileStorage(), serverId, published.presentation);
    else forgetColors(profileStorage());
  }, [published, serverId]);
  useEffect(() => {
    if (!presentation) return;
    applyInheritedColors(presentation);
    return () => applyInheritedColors(null);
  }, [presentation]);
  return (
    <ThemeColorsContext.Provider value={{ status: published, presentation }}>
      {children}
    </ThemeColorsContext.Provider>
  );
}

/** Approved product screens only: gates and unapproved screens never read or receive theme colors. */
export function InheritedColors({ children }: { children: ReactNode }) {
  const serverId = useServerId();
  return serverId ? (
    <FollowInheritedColors key={serverId} serverId={serverId}>
      {children}
    </FollowInheritedColors>
  ) : (
    children
  );
}
