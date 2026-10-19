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
  return openModelCore(renamed(parsed.value.snapshot, catalog), catalog, options);
}

/**
 * Files from before the catalog's ids were renamed carry another prefix for the
 * catalog and its connection types. Same version and the same id after the
 * prefix mean the same thing.
 */
function renamed(snapshot: ConstructionSnapshot, catalog: PartCatalog): ConstructionSnapshot {
  const stored = snapshot.design.catalog;
  const unprefixed = (id: string) => id.slice(id.indexOf('-') + 1);
  if (stored.id === catalog.ref.id || stored.version !== catalog.ref.version) return snapshot;
  if (unprefixed(stored.id) !== unprefixed(catalog.ref.id)) return snapshot;
  const current = new Map(catalog.connectionTypes.map((t) => [unprefixed(t.id), t.id]));
  return {
    ...snapshot,
    design: { ...snapshot.design, catalog: catalog.ref },
    realization: {
      ...snapshot.realization,
      connections: snapshot.realization.connections.map((c) => ({
        ...c,
        typeId: current.get(unprefixed(c.typeId)) ?? c.typeId,
      })),
    },
  };
}

export const constructionCodec: ConstructionCodec = {
  encode: encodeConstruction,
  decode(json, catalog, options) {
    const opened = openConstruction(json, catalog, options);
    return opened.ok ? { ok: true, value: opened.value.snapshot, diagnostics: opened.diagnostics } : opened;
  },
};
