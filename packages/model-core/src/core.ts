import type { CollisionGeometryProvider } from './buildability.js';
import type { PartCatalog } from './catalog.js';
import type { EditCommand } from './commands.js';
import type { ConstructionDesign } from './design.js';
import type { Diagnostic, Result } from './diagnostics.js';
import type { GeometryTolerance, Pose } from './geometry.js';
import type { IntentRef, PartId, PartTypeId } from './ids.js';
import type { Realization } from './realization.js';

/** A valid aggregate. A plain object of this shape still requires runtime validation. */
export interface ConstructionSnapshot {
  readonly revision: number;
  readonly design: ConstructionDesign;
  readonly realization: Realization;
}

/** Frame of site b in site a for a parametric connection. */
export type ConnectionEvaluator = (parameters: Readonly<Record<string, number>>) => Pose;

export interface SolveOptions {
  readonly tolerance: GeometryTolerance;
  /** Keyed by ConnectionType evaluatorKey; a missing evaluator is missing catalog data. */
  readonly connectionEvaluators?: Readonly<Record<string, ConnectionEvaluator>>;
}

/** Domain service: deterministic selection, geometry, closure and collision checks. */
export interface RealizationSolver {
  solve(
    design: ConstructionDesign,
    catalog: PartCatalog,
    options: SolveOptions,
    previous?: Realization,
  ): Result<Realization>;
}

export interface VariantChange {
  readonly intent: IntentRef;
  readonly partId: PartId;
  readonly previousTypeId?: PartTypeId;
  readonly selectedTypeId: PartTypeId;
  /** Editor persistently marks nonstandard drilling variants. */
  readonly nonstandard: boolean;
}

export type EditPreview =
  | {
      readonly status: 'valid';
      readonly baseRevision: number;
      readonly candidate: ConstructionSnapshot;
      readonly variantChanges: readonly VariantChange[];
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly status: 'invalid';
      readonly baseRevision: number;
      readonly attemptedDesign?: ConstructionDesign;
      readonly diagnostics: readonly Diagnostic[];
    };

/**
 * Owns the consistency boundary. Inputs/snapshots are treated as immutable.
 * preview never mutates state; execute revalidates and commits only a valid result.
 * Commands targeting an old revision fail without changing the current snapshot.
 */
export interface ModelCore {
  readonly snapshot: ConstructionSnapshot;
  preview(command: EditCommand): EditPreview;
  execute(command: EditCommand): Result<ConstructionSnapshot>;
}

/** Solving plus the independent buildability check before every commit. */
export interface ModelCoreOptions extends SolveOptions {
  readonly geometry: CollisionGeometryProvider;
  /** Distances below this between unconnected parts yield a warning; default 0. */
  readonly minClearanceMm?: number;
}

export interface ModelCoreFactory {
  /** Validates the catalog, references and all aggregate invariants. */
  create(design: ConstructionDesign, catalog: PartCatalog, options: ModelCoreOptions): Result<ModelCore>;
}
