import type { Pose } from './geometry.js';
import type {
  AttachmentRef,
  ConnectionId,
  ConnectionTypeId,
  IntentRef,
  PartId,
  PartTypeId,
  PlateId,
  SiteId,
  TubeId,
} from './ids.js';

export interface PartInstance {
  readonly id: PartId;
  readonly typeId: PartTypeId;
  readonly origin: {
    readonly intent: IntentRef;
    /** Stable role within a realization, e.g. tube-body or junction-angle-adapter-1. */
    readonly role: string;
  };
}

export interface Connection {
  readonly id: ConnectionId;
  readonly a: AttachmentRef;
  readonly b: AttachmentRef;
  readonly typeId: ConnectionTypeId;
  /** All kinematic parameters are resolved; no moving joints in the first solver. */
  readonly parameters: Readonly<Record<string, number>>;
}

export interface PlateMountResolution {
  readonly plateId: PlateId;
  readonly plateSiteId: SiteId;
  readonly tubeId: TubeId;
  readonly tubeHole: AttachmentRef;
  readonly connectionId: ConnectionId;
}

export interface Realization {
  readonly parts: readonly PartInstance[];
  readonly connections: readonly Connection[];
  readonly plateMounts: readonly PlateMountResolution[];
  /** Derived poses, complete for every realised physical part. */
  readonly poses: readonly PartPose[];
  /** Logical frames, including junctions whose realisation spans several parts. */
  readonly intentPoses: readonly IntentPose[];
}

export interface IntentPose {
  readonly intent: IntentRef;
  readonly worldPose: Pose;
}

export interface PartPose {
  readonly partId: PartId;
  readonly worldPose: Pose;
}
