import type { GridDirection } from './article-catalog.js';
import type { CatalogRef } from './catalog.js';
import type { AngularConstraint, Pose, Quaternion } from './geometry.js';
import type {
  AnchorId,
  ColourId,
  ConstructionId,
  FamilyId,
  IntentRef,
  JunctionId,
  PartTypeId,
  PlateId,
  SiteId,
  SlideId,
  TubeId,
} from './ids.js';

export type VariantPolicy =
  | { readonly mode: 'automatic'; readonly preferredTypeId?: PartTypeId }
  | { readonly mode: 'fixed'; readonly typeId: PartTypeId };

/**
 * Required for tubes and plates. The editor presets the catalog default; reading
 * a file without a colour fills in red for tubes and blue for plates.
 */
export interface Appearance {
  /** Colour key of the article catalog, not a renderer material. */
  readonly colour: ColourId;
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
  /**
   * For an oblique end: the connector arm, in junction coordinates, that carries
   * the angle adapter. Without it the solver picks one of the two possible arms.
   */
  readonly adapterArm?: GridDirection;
}

export interface TubeIntent {
  readonly id: TubeId;
  /** Fixes shape and length, while permitting compatible drilling variants. */
  readonly familyId: FamilyId;
  readonly a: TubeEndpoint;
  readonly b: TubeEndpoint;
  readonly variant: VariantPolicy;
  readonly appearance: Appearance;
}

export interface JunctionIntent {
  readonly id: JunctionId;
  /**
   * Frame relative to the grid of its assembly, where it differs: at the free end
   * of an oblique tube the connector tilts with the tube. Tubes attached there
   * pass it on to their new junctions.
   */
  readonly tilt?: Quaternion;
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
  readonly appearance: Appearance;
}

/**
 * Slide body or runout hanging on a straight, horizontal tube. It runs away from
 * the tube horizontally in the direction toward, in the frame of the tube's
 * junction a, whose +z counts as up. A body drops from there to a parallel tube
 * further down (SPEC 7.5).
 */
export interface SlideIntent {
  readonly id: SlideId;
  readonly familyId: FamilyId;
  readonly tubeId: TubeId;
  readonly toward: GridDirection;
  readonly appearance: Appearance;
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
  /** Name chosen by the user; file names and the list of recent models derive from it. */
  readonly name?: string;
  readonly catalog: CatalogRef;
  readonly tubes: readonly TubeIntent[];
  readonly junctions: readonly JunctionIntent[];
  readonly plates: readonly PlateIntent[];
  readonly slides: readonly SlideIntent[];
  readonly anchors: readonly PlacementAnchor[];
}
