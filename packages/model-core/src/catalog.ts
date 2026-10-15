import type { GeometryRef, Pose } from './geometry.js';
import type { ConnectionTypeId, FamilyId, PartTypeId, SiteId, TubeEnd } from './ids.js';

export interface CatalogRef {
  readonly id: string;
  /** Changes whenever geometry or mounting rules change. */
  readonly version: string;
}

export interface AttachmentSite {
  readonly id: SiteId;
  readonly role: 'tube-end' | 'socket' | 'hole' | 'mount';
  /** Full site frame in part coordinates; local +Z points out of the site. */
  readonly frame: Pose;
  /** Open catalog vocabulary, interpreted by connection rules. */
  readonly interfaceId: string;
  readonly capacity: number;
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
  /** Every required mounting site must be realised. */
  readonly requiredMounts: readonly SiteId[];
}

export interface AccessoryType extends PartTypeBase {
  readonly kind: 'connector' | 'adapter' | 'accessory';
}

export type PartType = TubeType | PlateType | AccessoryType;

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

