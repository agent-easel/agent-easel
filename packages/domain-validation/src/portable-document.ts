import type { PortableAgentDocument } from "@t3-factory/contracts";

/** The largest create or save request for one Agent or Flow definition. */
export const DEFINITION_REQUEST_LIMIT_BYTES = 2_000_000;

/** The largest portable document an import accepts (16 MiB). */
export const PORTABLE_DOCUMENT_LIMIT_BYTES = 16_777_216;

/** The exact file text of a portable document; export measures this text against the import limit. */
export function portableDocumentText(document: PortableAgentDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
