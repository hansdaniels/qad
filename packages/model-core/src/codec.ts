import type { PartCatalog } from './catalog.js';
import type { ConstructionSnapshot, ModelCore, ModelCoreOptions } from './core.js';
import type { ConstructionDocument } from './document-schema.js';
import type { Result } from './diagnostics.js';
import { openModelCore } from './model-core.js';
import { parseConstructionDocument } from './parse-document.js';
import type { ConstructionCodec } from './persistence.js';

/** JSON of the current file format for a snapshot: design and chosen realization. */
export function encodeConstruction(snapshot: ConstructionSnapshot): string {
  const document: ConstructionDocument = { format: 'qad-construction', schemaVersion: 1, snapshot };
  return JSON.stringify(document, null, 2);
}

/** Parses untrusted JSON and opens the stored state after full verification. */
export function openConstruction(json: string, catalog: PartCatalog, options: ModelCoreOptions): Result<ModelCore> {
  const parsed = parseConstructionDocument(json);
  if (!parsed.ok) return parsed;
  return openModelCore(parsed.value.snapshot, catalog, options);
}

export const constructionCodec: ConstructionCodec = {
  encode: encodeConstruction,
  decode(json, catalog, options) {
    const opened = openConstruction(json, catalog, options);
    return opened.ok ? { ok: true, value: opened.value.snapshot, diagnostics: opened.diagnostics } : opened;
  },
};
