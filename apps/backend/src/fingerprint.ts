import { createHash } from "node:crypto";

export const fingerprint = (content: string) => createHash("sha256").update(content).digest("hex");

/** A stored payload is intact only when it still matches the fingerprint recorded with it. */
export const intactPayload = <
  I extends {
    payload_json: string | null;
    fingerprint: string;
  },
>(
  intent: I,
): intent is I & {
  payload_json: string;
} => !!intent.payload_json && fingerprint(intent.payload_json) === intent.fingerprint;
