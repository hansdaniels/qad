/** Right-handed coordinates. All lengths are millimetres, angles radians. */
export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Unit quaternion, active rotation from local coordinates to parent coordinates. */
export interface Quaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** p_parent = orientation * p_local + position. No scale or reflection. */
export interface Pose {
  readonly position: Vector3;
  readonly orientation: Quaternion;
}

export interface GeometryTolerance {
  readonly distanceMm: number;
  readonly angleRad: number;
}

/** A preference must never be promoted silently to a fixed constraint. */
export type AngularConstraint =
  | { readonly mode: 'free'; readonly preferredRad?: number }
  | { readonly mode: 'fixed'; readonly radians: number };

/** Catalog-owned geometry key, independent of a renderer's mesh objects. */
export interface GeometryRef {
  readonly key: string;
}
