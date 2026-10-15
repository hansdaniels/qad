import type { PartCatalog } from './catalog.js';
import type { ConstructionSnapshot, ModelCoreOptions } from './core.js';
import type { Result } from './diagnostics.js';

export type { ConstructionDocument } from './document-schema.js';

export interface ConstructionCodec {
  encode(snapshot: ConstructionSnapshot): string;
  /** Parse untrusted JSON, check schema/catalog, then revalidate the realization. */
  decode(json: string, catalog: PartCatalog, options: ModelCoreOptions): Result<ConstructionSnapshot>;
}
