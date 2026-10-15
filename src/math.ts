import type { Pose, Quaternion, Vector3 } from './geometry.js';

/** Small, allocation-light rigid-transform helpers. Quaternions are (x, y, z, w). */

export const IDENTITY: Pose = {
  position: { x: 0, y: 0, z: 0 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
};

export function vec(x: number, y: number, z: number): Vector3 {
  return { x, y, z };
}

export function add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: Vector3, s: number): Vector3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vector3, b: Vector3): Vector3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function length(a: Vector3): number {
  return Math.sqrt(dot(a, a));
}

export function qmul(a: Quaternion, b: Quaternion): Quaternion {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function qconj(q: Quaternion): Quaternion {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

export function qnorm(q: Quaternion): number {
  return Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
}

export function qaxisAngle(axis: Vector3, angleRad: number): Quaternion {
  const n = length(axis);
  const s = Math.sin(angleRad / 2) / n;
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(angleRad / 2) };
}

export function rotate(q: Quaternion, v: Vector3): Vector3 {
  const u = { x: q.x, y: q.y, z: q.z };
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q.w)), cross(u, t));
}

/** Rotation angle of q in [0, π]. */
export function qangle(q: Quaternion): number {
  const w = Math.min(1, Math.abs(q.w) / qnorm(q));
  return 2 * Math.acos(w);
}

/** a · b: b expressed in a's frame, mapped to a's parent. */
export function compose(a: Pose, b: Pose): Pose {
  return {
    position: add(a.position, rotate(a.orientation, b.position)),
    orientation: qmul(a.orientation, b.orientation),
  };
}

export function inverse(p: Pose): Pose {
  const q = qconj(p.orientation);
  return { position: scale(rotate(q, p.position), -1), orientation: q };
}

export function transformPoint(p: Pose, v: Vector3): Vector3 {
  return add(p.position, rotate(p.orientation, v));
}

/**
 * Tilt and twist of a rotation relative to the local z axis (swing-twist split).
 * Tilt is the angle between z and its image; twist the remaining turn about z.
 */
export function tiltTwist(q: Quaternion): { tiltRad: number; twistRad: number } {
  const n = qnorm(q);
  const z = rotate({ x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n }, vec(0, 0, 1));
  const tiltRad = Math.acos(Math.max(-1, Math.min(1, z.z)));
  // Twist is undefined for a tilt of π; report none rather than an arbitrary value.
  const twistRad = Math.hypot(q.z, q.w) < 1e-12 ? 0 : 2 * Math.atan2(Math.abs(q.z), Math.abs(q.w));
  return { tiltRad, twistRad };
}

/** The 24 rotations that map coordinate axes onto coordinate axes. */
export const AXIS_ROTATIONS: readonly Quaternion[] = (() => {
  const result: Quaternion[] = [];
  const s = Math.SQRT1_2;
  const candidates: Quaternion[] = [];
  const values = [0, 0.5, -0.5, s, -s, 1, -1];
  for (const w of values) for (const x of values) for (const y of values) for (const z of values) {
    if (Math.abs(w * w + x * x + y * y + z * z - 1) < 1e-9) candidates.push({ x, y, z, w });
  }
  for (const q of candidates) {
    const ok = [vec(1, 0, 0), vec(0, 1, 0), vec(0, 0, 1)].every((axis) => {
      const r = rotate(q, axis);
      return [r.x, r.y, r.z].filter((c) => Math.abs(Math.abs(c) - 1) < 1e-9).length === 1;
    });
    const duplicate = result.some((p) => Math.abs(Math.abs(p.x * q.x + p.y * q.y + p.z * q.z + p.w * q.w) - 1) < 1e-9);
    if (ok && !duplicate) result.push(q);
  }
  return result;
})();
