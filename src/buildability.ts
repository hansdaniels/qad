import type { PartCatalog } from './catalog.js';
import type { DesignOperation } from './commands.js';
import type { ConstructionSnapshot, SolveOptions } from './core.js';
import type { Diagnostic } from './diagnostics.js';
import type { GeometryRef, Vector3 } from './geometry.js';
import type {
  ConnectionId, FamilyId, PartId, PartTypeId, PlateId, SiteId, TubeId,
} from './ids.js';

export type BuildabilityVerdict =
  | 'buildable'
  | 'not-buildable'
  /** Required catalog data is missing; never treated as a pass. */
  | 'undetermined';

export type CheckStage = 'structure' | 'closure' | 'junction-angles' | 'collision' | 'plate-mounts';

/**
 * Closing-site position error and relative rotation, expressed in site a axes.
 * Rotate the residual out of the expected site b frame before decomposition.
 */
export interface ClosureResidual {
  readonly connectionId: ConnectionId;
  /** Parts on the cycle closed by this connection, in traversal order. */
  readonly cycle: readonly PartId[];
  /**
   * Actual minus expected site b position along site a's outward +Z axis.
   * Site +Z points away from its part, so positive is a gap (not fully mated),
   * negative an overlap (mated deeper than the rule allows).
   */
  readonly axialMm: number;
  readonly lateralMm: number;
  readonly tiltRad: number;
  readonly twistRad: number;
}

/** A plate mount requirement expressed in the tube type's own frame. */
export interface RequiredHole {
  readonly tubeId: TubeId;
  readonly plateId: PlateId;
  readonly plateSiteId: SiteId;
  readonly stationMm: number;
  /** Around the tube axis in the tube type frame, before roll. */
  readonly angleRad: number;
  readonly interfaceId: string;
  /** Offset across the axis: tube spacing does not match the plate. */
  readonly residualMm: number;
  /** Closest existing hole of the realised type and roll, if any. */
  readonly nearest?: {
    readonly siteId: SiteId;
    readonly stationDeltaMm: number;
    readonly angleDeltaRad: number;
  };
}

/** Hints only; the checker never applies them. */
export type Remedy =
  | { readonly kind: 'change-roll'; readonly tubeId: TubeId; readonly rollRad: number }
  | { readonly kind: 'select-variant'; readonly tubeId: TubeId; readonly typeId: PartTypeId; readonly rollRad: number }
  | { readonly kind: 'move-plate'; readonly plateId: PlateId; readonly translation: Vector3 }
  | { readonly kind: 'change-tube-family'; readonly tubeId: TubeId; readonly familyId: FamilyId }
  | { readonly kind: 'insert-adapter'; readonly connectionId: ConnectionId; readonly adapterTypeId: PartTypeId };

export interface BuildabilityFinding {
  readonly stage: CheckStage;
  readonly diagnostic: Diagnostic;
  readonly closure?: ClosureResidual;
  readonly requiredHoles?: readonly RequiredHole[];
  readonly remedies: readonly {
    readonly remedy: Remedy;
    /** Ready for ModelCore.preview, when expressible as a design edit. */
    readonly operations?: readonly DesignOperation[];
  }[];
}

export interface BuildabilityReport {
  /** Only buildable permits committing or loading the snapshot. */
  readonly verdict: BuildabilityVerdict;
  /** Deterministic order: stage, then subject IDs. */
  readonly findings: readonly BuildabilityFinding[];
  readonly missingCatalogData: readonly GeometryRef[];
  readonly stats: {
    readonly parts: number;
    readonly connections: number;
    readonly cycles: number;
    readonly collisionPairsTested: number;
  };
}

export interface BuildabilityOptions extends SolveOptions {
  /** Distances below this, without penetration, yield a clearance warning. */
  readonly minClearanceMm: number;
  readonly maxRemediesPerFinding: number;
}

/**
 * Describes one editing step. Omitted when loading: full check, no deferred edges.
 * Tests may pass addedConnectionIds without affectedParts to compare with a full check.
 */
export interface EditContext {
  /**
   * Connections added by this edit, including solver-generated replacements.
   * Deferred while building the spanning forest so new cycle edges are reported.
   */
  readonly addedConnectionIds: readonly ConnectionId[];
  /**
   * All surviving parts affected by the edit or solver, including changed
   * constraints/connections and dependent parts. An anchor move includes its
   * entire assembly. Collision candidates include unaffected parts as well.
   * Omitted: every part is affected.
   */
  readonly affectedParts?: readonly PartId[];
}

/** Narrow-phase primitives in part coordinates. */
export type CollisionShape =
  | { readonly kind: 'capsule'; readonly a: Vector3; readonly b: Vector3; readonly radiusMm: number }
  | { readonly kind: 'box'; readonly center: Vector3; readonly halfExtents: Vector3 }
  | { readonly kind: 'convex'; readonly points: readonly Vector3[] };

export interface CollisionGeometryProvider {
  /** Undefined marks missing catalog data and leads to an undetermined verdict. */
  shapes(ref: GeometryRef): readonly CollisionShape[] | undefined;
}

/** Read-only domain service. Recomputes poses instead of trusting cached ones. */
export interface BuildabilityChecker {
  check(
    snapshot: ConstructionSnapshot,
    catalog: PartCatalog,
    geometry: CollisionGeometryProvider,
    options: BuildabilityOptions,
    edit?: EditContext,
  ): BuildabilityReport;
}
