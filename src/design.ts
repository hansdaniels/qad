import type { CatalogRef } from './catalog.js';
import type { AngularConstraint, Pose, Quaternion } from './geometry.js';
import type {
  AnchorId, ConstructionId, FamilyId, IntentRef, JunctionId,
  PartTypeId, PlateId, SiteId, TubeId,
} from './ids.js';

export type VariantPolicy =
  | { readonly mode: 'automatic'; readonly preferredTypeId?: PartTypeId }
  | { readonly mode: 'fixed'; readonly typeId: PartTypeId };

export interface Appearance {
  /** Catalog/application colour key, not a renderer material. */
  readonly colour: string;
}

export interface TubeEndpoint {
  readonly junctionId: JunctionId;
  /**
   * Reference end orientation in junction coordinates. Local +Z points into the
   * tube; X/Y define the reference for roll, including the bending plane.
   * This is a logical orientation, not the physical attachment position.
   */
  readonly orientation: Quaternion;
  /** Additional rotation around the reference frame's local +Z axis. */
  readonly roll: AngularConstraint;
}

export interface TubeIntent {
  readonly id: TubeId;
  /** Fixes shape and length, while permitting compatible drilling variants. */
  readonly familyId: FamilyId;
  readonly a: TubeEndpoint;
  readonly b: TubeEndpoint;
  readonly variant: VariantPolicy;
  readonly appearance?: Appearance;
}

export interface JunctionIntent {
  readonly id: JunctionId;
  // Membership is derived from TubeEndpoint references, never stored twice.
}

export interface PlateMountIntent {
  /** Stable mounting site within the selected plate family. */
  readonly plateSiteId: SiteId;
  readonly tubeId: TubeId;
  readonly stationMm: number;
  readonly hole:
    | { readonly mode: 'automatic' }
    | {
        readonly mode: 'fixed';
        /** Fixing a site also fixes its type-specific meaning. */
        readonly tubeTypeId: PartTypeId;
        readonly siteId: SiteId;
      };
}

export interface PlateIntent {
  readonly id: PlateId;
  readonly familyId: FamilyId;
  readonly variant: VariantPolicy;
  /** Desired plate frame in a logical junction frame, independent of tube roll. */
  readonly placement: {
    readonly junctionId: JunctionId;
    readonly pose: Pose;
  };
  readonly mounts: readonly PlateMountIntent[];
  readonly appearance?: Appearance;
}

export interface PlacementAnchor {
  readonly id: AnchorId;
  /** One anchor per connected assembly; target identifies its reference frame. */
  readonly target: IntentRef;
  readonly worldPose: Pose;
}

/** JSON-shaped source of truth. Positions of physical parts are not stored here. */
export interface ConstructionDesign {
  readonly id: ConstructionId;
  readonly catalog: CatalogRef;
  readonly tubes: readonly TubeIntent[];
  readonly junctions: readonly JunctionIntent[];
  readonly plates: readonly PlateIntent[];
  readonly anchors: readonly PlacementAnchor[];
}
