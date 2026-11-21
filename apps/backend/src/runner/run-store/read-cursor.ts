import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const cursorKey = randomBytes(32);

const cursorSignature = (payload: string) =>
  createHmac("sha256", cursorKey).update(payload).digest();

export const encodeCursor = <Cursor extends readonly unknown[]>(cursor: Cursor) => {
  const payload = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
  return `${payload}.${cursorSignature(payload).toString("base64url")}`;
};

export function decodeCursor<Cursor>(text: string): Cursor | undefined {
  const [payload, signature, ...rest] = text.split(".");
  if (payload === undefined || signature === undefined || rest.length) return undefined;
  const expected = cursorSignature(payload);
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
  if (actual.toString("base64url") !== signature) return undefined;
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Cursor;
}
