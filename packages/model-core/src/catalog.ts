import type { CollisionShape } from './buildability.js';
import type { GeometryRef, Pose, Vector3 } from './geometry.js';
import type { ConnectionTypeId, FamilyId, PartTypeId, SiteId, TubeEnd } from './ids.js';

export interface CatalogRef {
  readonly id: string;
  /** Changes whenever geometry or mounting rules change. */
  readonly version: string;
}

export interface AttachmentSite {
  readonly id: SiteId;
  readonly role: 'tube-end' | 'socket' | 'hole' | 'mount' | 'hang';
  /** Full site frame in part coordinates; local +Z points out of the site. */
  readonly frame: Pose;
  /** Open catalog vocabulary, interpreted by connection rules. */
  readonly interfaceId: string;
  readonly capacity: number;
}

/**
 * Flat body in the part's x-y plane: an outline extruded upwards from bottomZ,
 * cut through by round holes. Display only; collision keeps simpler shapes.
 */
export interface SlabShape {
  readonly kind: 'slab';
  /** Counter-clockwise. */
  readonly outline: readonly { readonly x: number; readonly y: number }[];
  readonly holes: readonly { readonly x: number; readonly y: number; readonly radiusMm: number }[];
  readonly bottomZ: number;
  readonly thicknessMm: number;
}

/** Cylinder from a to b; hollow and open at both ends when innerRadiusMm is above 0. */
export interface PipeShape {
  readonly kind: 'pipe';
  readonly a: Vector3;
  readonly b: Vector3;
  readonly radiusMm: number;
  readonly innerRadiusMm: number;
}

/** Part of a ring in the part's x-y plane, from startRad to endRad about centre, e.g. a bend. */
export interface ArcShape {
  readonly kind: 'arc';
  readonly center: Vector3;
  readonly radiusMm: number;
  readonly tubeRadiusMm: number;
  readonly startRad: number;
  readonly endRad: number;
}

/** A line from a to b that marks a bend, e.g. the edge of a half plate with bent tabs: drawn in a signal colour. */
export interface FoldShape {
  readonly kind: 'fold';
  readonly a: Vector3;
  readonly b: Vector3;
}

/**
 * Rational B-spline surface, e.g. a moulded slide: points[i][j] with weight w,
 * i along knotsU, j along knotsV; points are Euclidean, not multiplied by w.
 */
export interface NurbsShape {
  readonly kind: 'nurbs';
  readonly degreeU: number;
  readonly degreeV: number;
  readonly knotsU: readonly number[];
  readonly knotsV: readonly number[];
  readonly points: readonly (readonly {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly w: number;
  }[])[];
}

export type DisplayShape = CollisionShape | SlabShape | PipeShape | ArcShape | FoldShape | NurbsShape;

export interface DisplayGeometryProvider {
  /** Undefined when the part has no display geometry of its own; its collision shapes stand in. */
  shapes(ref: GeometryRef): readonly DisplayShape[] | undefined;
}

export interface PartGeometry {
  readonly display: GeometryRef;
  readonly collision: GeometryRef;
}

export interface PartTypeBase {
  readonly id: PartTypeId;
  readonly familyId: FamilyId;
  readonly name: string;
  readonly articleNumber?: string;
  /** Article catalog entry, where it differs from the ID, e.g. for a half plate with a bent tab. */
  readonly entryId?: string;
  readonly geometry: PartGeometry;
  readonly sites: readonly AttachmentSite[];
}

/** Variants in a tube family share shape, end frames and station numbering. */
export interface TubeType extends PartTypeBase {
  readonly kind: 'tube';
  readonly shape: 'straight' | 'bent';
  /** Product designation, not the assembled distance between junctions. */
  readonly nominalLengthMm: number;
  readonly centerlineLengthMm: number;
  readonly ends: Readonly<Record<TubeEnd, SiteId>>;
  readonly holes: readonly TubeHole[];
  readonly standardVariant: boolean;
}

export interface TubeHole {
  readonly siteId: SiteId;
  /** Arc length from end a along the catalog centerline. */
  readonly stationMm: number;
  /** Orientation and radial offset are given by the corresponding site frame. */
}

export interface PlateType extends PartTypeBase {
  readonly kind: 'plate';
  /** Distances between the junction centres of its grid cell along plate x and y. */
  readonly cellMm: readonly [number, number];
  /** Every required mounting site must be realised. */
  readonly requiredMounts: readonly SiteId[];
  /**
   * Variant of the flat type base whose flange tabs are bent by 90° at the given
   * cell edges, where a level plate meets this upright one (HERSTELLERREGELN 1).
   * The solver picks it; the design names only the family.
   */
  readonly folded?: { readonly base: PartTypeId; readonly edges: readonly PlateEdge[] };
}

/** Cell edge of a plate across its flanges: at the low or high end of plate x. */
export type PlateEdge = '-x' | '+x';

/**
 * Slide body or runout: hangs on the middle of a tube with its origin on the
 * tube axis, +x running away from the tube, +z up.
 */
export interface SlideType extends PartTypeBase {
  readonly kind: 'slide';
  readonly shape: 'body' | 'curved' | 'runout';
  /** Bodies only: where the lower end rests and how the slide goes on from there, in its own frame. */
  readonly lowerEnd?: {
    /** Middle of the tube it rests on. */
    readonly point: Vector3;
    /** Axis of that tube: along y for a straight body, along x for one that turns. */
    readonly tubeAxis: Vector3;
    /** Direction the next slide or the runout hangs on that tube. */
    readonly onward: Vector3;
    /** Plate screws at the top and slide screws where it rests on the next one. */
    readonly screws: { readonly plate: number; readonly joint: number };
  };
  /** Length of the tube it hangs on: the slide fits between the posts at its ends. */
  readonly tubeLengthMm: number;
}

export interface AccessoryType extends PartTypeBase {
  readonly kind: 'connector' | 'adapter' | 'accessory';
}

export type PartType = TubeType | PlateType | SlideType | AccessoryType;

export interface ConnectionParameter {
  readonly name: string;
  readonly unit: 'radian' | 'millimetre';
  readonly domain:
    | { readonly kind: 'discrete'; readonly values: readonly number[] }
    | { readonly kind: 'interval'; readonly min: number; readonly max: number };
}

/**
 * A rule defines ordered mating interfaces and the frame of site b in site a.
 * Fixed transforms include insertion depth and mating orientation, not just angle.
 * Parametric rules require the matching geometry provider implementation.
 */
export interface ConnectionType {
  readonly id: ConnectionTypeId;
  readonly aInterfaceId: string;
  readonly bInterfaceId: string;
  readonly kinematics:
    | { readonly kind: 'fixed'; readonly bInA: Pose }
    | {
        readonly kind: 'parametric';
        readonly evaluatorKey: string;
        readonly parameters: readonly ConnectionParameter[];
      };
  /** Permitted intersection volume in site a coordinates, not a pair-wide exemption. */
  readonly allowedOverlap?: GeometryRef;
}

export interface PartCatalog {
  readonly ref: CatalogRef;
  readonly partTypes: readonly PartType[];
  readonly connectionTypes: readonly ConnectionType[];
}
