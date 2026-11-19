import type { T3Session } from "./connection.ts";

export const hasEnvironmentIdentity = (body: unknown): body is { environmentId: string } =>
  typeof body === "object" &&
  body !== null &&
  "environmentId" in body &&
  typeof body.environmentId === "string" &&
  body.environmentId !== "";

export async function readEnvironmentIdentity(session: T3Session): Promise<string | null> {
  const answer = await session.call("t3_environment_read", {}, 10_000);
  return !answer.isError && hasEnvironmentIdentity(answer.content)
    ? answer.content.environmentId
    : null;
}
