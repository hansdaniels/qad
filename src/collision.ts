import type { CollisionShape } from './buildability.js';
import type { Pose, Vector3 } from './geometry.js';
import { add, cross, dot, length, rotate, scale, sub, transformPoint, vec } from './math.js';

/** A convex shape in world coordinates: core polytope or segment plus a radius. */
export interface WorldShape {
  readonly support: (d: Vector3) => Vector3;
  readonly radius: number;
  readonly min: Vector3;
  readonly max: Vector3;
  /** Points inside the shape, used to sample overlap regions. */
  readonly samples: () => Vector3[];
}

export function toWorld(shape: CollisionShape, pose: Pose): WorldShape {
  switch (shape.kind) {
    case 'capsule': {
      const a = transformPoint(pose, shape.a);
      const b = transformPoint(pose, shape.b);
      const r = shape.radiusMm;
      return {
        support: (d) => (dot(a, d) >= dot(b, d) ? a : b),
        radius: r,
        min: vec(Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.min(a.z, b.z) - r),
        max: vec(Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r, Math.max(a.z, b.z) + r),
        samples: () => capsuleSamples(a, b, r),
      };
    }
    case 'box': {
      const c = transformPoint(pose, shape.center);
      const axes = [vec(1, 0, 0), vec(0, 1, 0), vec(0, 0, 1)].map((u) => rotate(pose.orientation, u));
      const h = [shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z];
      const corners = [];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        corners.push(add(c, add(scale(axes[0]!, sx * h[0]!), add(scale(axes[1]!, sy * h[1]!), scale(axes[2]!, sz * h[2]!)))));
      }
      return polytope(corners, () => {
        const points: Vector3[] = [];
        for (const fx of [-1, -0.5, 0, 0.5, 1]) for (const fy of [-1, -0.5, 0, 0.5, 1]) for (const fz of [-1, -0.5, 0, 0.5, 1]) {
          points.push(add(c, add(scale(axes[0]!, fx * h[0]!), add(scale(axes[1]!, fy * h[1]!), scale(axes[2]!, fz * h[2]!)))));
        }
        return points;
      });
    }
    case 'convex': {
      const points = shape.points.map((p) => transformPoint(pose, p));
      return polytope(points, () => {
        const centre = scale(points.reduce(add, vec(0, 0, 0)), 1 / points.length);
        return [centre, ...points, ...points.map((p) => scale(add(p, centre), 0.5))];
      });
    }
  }
}

function polytope(points: readonly Vector3[], samples: () => Vector3[]): WorldShape {
  return {
    support: (d) => points.reduce((best, p) => (dot(p, d) > dot(best, d) ? p : best)),
    radius: 0,
    min: vec(Math.min(...points.map((p) => p.x)), Math.min(...points.map((p) => p.y)), Math.min(...points.map((p) => p.z))),
    max: vec(Math.max(...points.map((p) => p.x)), Math.max(...points.map((p) => p.y)), Math.max(...points.map((p) => p.z))),
    samples,
  };
}

function capsuleSamples(a: Vector3, b: Vector3, r: number): Vector3[] {
  const axis = sub(b, a);
  const helper = Math.abs(axis.x) < 0.9 * length(axis) ? vec(1, 0, 0) : vec(0, 1, 0);
  const u = normalized(cross(axis, helper));
  const w = normalized(cross(axis, u));
  const points: Vector3[] = [];
  // Hemispherical caps beyond the segment ends.
  const along = normalized(axis);
  for (const f of [0.5, 0.95]) points.push(sub(a, scale(along, r * f)), add(b, scale(along, r * f)));
  for (let i = 0; i <= 10; i++) {
    const c = add(a, scale(axis, i / 10));
    points.push(c);
    for (let k = 0; k < 8; k++) {
      const angle = (k * Math.PI) / 4;
      for (const f of [0.5, 0.95]) {
        points.push(add(c, add(scale(u, Math.cos(angle) * r * f), scale(w, Math.sin(angle) * r * f))));
      }
    }
  }
  return points;
}

function normalized(v: Vector3): Vector3 {
  const n = length(v);
  return n === 0 ? vec(1, 0, 0) : scale(v, 1 / n);
}

/** Distance between the cores (0 when they intersect), by GJK. */
export function coreDistance(a: WorldShape, b: WorldShape): number {
  const support = (d: Vector3) => sub(a.support(d), b.support(scale(d, -1)));
  let simplex: Vector3[] = [support(vec(1, 0, 0))];
  let v = simplex[0]!;
  for (let iteration = 0; iteration < 64; iteration++) {
    const vv = dot(v, v);
    if (vv < 1e-18) return 0;
    const w = support(scale(v, -1));
    if (vv - dot(v, w) <= 1e-9 * Math.max(1, vv)) return Math.sqrt(vv);
    simplex = [...simplex, w];
    const closest = closestOnSimplex(simplex);
    simplex = closest.simplex;
    if (simplex.length === 4) return 0;
    v = closest.point;
  }
  return length(v);
}

/** Closest point of the simplex hull to the origin, and the reduced simplex. */
function closestOnSimplex(points: Vector3[]): { point: Vector3; simplex: Vector3[] } {
  if (points.length === 1) return { point: points[0]!, simplex: points };
  if (points.length === 2) return closestOnSegment(points[0]!, points[1]!);
  if (points.length === 3) return closestOnTriangle(points[0]!, points[1]!, points[2]!);
  const [a, b, c, d] = points as [Vector3, Vector3, Vector3, Vector3];
  if (containsOrigin(a, b, c, d)) return { point: vec(0, 0, 0), simplex: points };
  let best: { point: Vector3; simplex: Vector3[] } | undefined;
  for (const face of [[a, b, c], [a, b, d], [a, c, d], [b, c, d]] as const) {
    const candidate = closestOnTriangle(face[0], face[1], face[2]);
    if (!best || dot(candidate.point, candidate.point) < dot(best.point, best.point)) best = candidate;
  }
  return best!;
}

function closestOnSegment(a: Vector3, b: Vector3): { point: Vector3; simplex: Vector3[] } {
  const ab = sub(b, a);
  const t = -dot(a, ab) / Math.max(dot(ab, ab), 1e-30);
  if (t <= 0) return { point: a, simplex: [a] };
  if (t >= 1) return { point: b, simplex: [b] };
  return { point: add(a, scale(ab, t)), simplex: [a, b] };
}

function closestOnTriangle(a: Vector3, b: Vector3, c: Vector3): { point: Vector3; simplex: Vector3[] } {
  // Ericson, Real-Time Collision Detection, 5.1.5, with p = origin.
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = scale(a, -1);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return { point: a, simplex: [a] };
  const bp = scale(b, -1);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return { point: b, simplex: [b] };
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return { point: add(a, scale(ab, d1 / (d1 - d3))), simplex: [a, b] };
  const cp = scale(c, -1);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return { point: c, simplex: [c] };
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return { point: add(a, scale(ac, d2 / (d2 - d6))), simplex: [a, c] };
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    return { point: add(b, scale(sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)))), simplex: [b, c] };
  }
  const denom = 1 / (va + vb + vc);
  return { point: add(a, add(scale(ab, vb * denom), scale(ac, vc * denom))), simplex: [a, b, c] };
}

function containsOrigin(a: Vector3, b: Vector3, c: Vector3, d: Vector3): boolean {
  const side = (p: Vector3, q: Vector3, r: Vector3, s: Vector3) => {
    const n = cross(sub(q, p), sub(r, p));
    return Math.sign(dot(n, sub(s, p))) * Math.sign(dot(n, scale(p, -1)));
  };
  return side(a, b, c, d) >= 0 && side(a, b, d, c) >= 0 && side(a, c, d, b) >= 0 && side(b, c, d, a) >= 0;
}

/** Signed distance between the shapes including radii; negative is penetration depth. */
export function separation(a: WorldShape, b: WorldShape): number {
  const core = coreDistance(a, b);
  if (core > 0) return core - a.radius - b.radius;
  return -(corePenetration(a, b) + a.radius + b.radius);
}

const DIRECTIONS: readonly Vector3[] = (() => {
  const result: Vector3[] = [];
  const n = 256;
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const phi = i * Math.PI * (3 - Math.sqrt(5));
    result.push(vec(Math.cos(phi) * r, y, Math.sin(phi) * r));
  }
  for (const axis of [vec(1, 0, 0), vec(0, 1, 0), vec(0, 0, 1)]) result.push(axis, scale(axis, -1));
  return result;
})();

/** Minimum overlap of the cores over directions, refined around the best sample. */
function corePenetration(a: WorldShape, b: WorldShape): number {
  const overlap = (d: Vector3) => dot(a.support(d), d) - dot(b.support(scale(d, -1)), d);
  let best = DIRECTIONS[0]!;
  let value = Infinity;
  for (const d of DIRECTIONS) {
    const o = overlap(scale(d, -1));
    if (o < value) { value = o; best = scale(d, -1); }
  }
  for (let step = 0.2; step > 1e-4; step /= 2) {
    let improved = true;
    while (improved) {
      improved = false;
      const u = normalized(cross(best, Math.abs(best.x) < 0.9 ? vec(1, 0, 0) : vec(0, 1, 0)));
      const w = cross(best, u);
      for (const delta of [u, scale(u, -1), w, scale(w, -1)]) {
        const d = normalized(add(best, scale(delta, step)));
        const o = overlap(d);
        if (o < value - 1e-12) { value = o; best = d; improved = true; }
      }
    }
  }
  return Math.max(0, value);
}

/** Whether a point lies inside the shape within the tolerance. */
export function containsPoint(shape: WorldShape, p: Vector3, tolerance: number): boolean {
  const point: WorldShape = { support: () => p, radius: 0, min: p, max: p, samples: () => [p] };
  return coreDistance(shape, point) <= shape.radius + tolerance;
}

/** Closest points of two segments as parameters s, t in [0, 1] (Ericson 5.1.9). */
export function segmentParameters(p1: Vector3, q1: Vector3, p2: Vector3, q2: Vector3): { s: number; t: number; distance: number } {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  let s: number;
  let t: number;
  const c = dot(d1, r);
  const b = dot(d1, d2);
  const denom = a * e - b * b;
  s = denom > 1e-12 ? clamp01((b * f - c * e) / denom) : 0;
  t = (b * s + f) / e;
  if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
  const distance = length(sub(add(p1, scale(d1, s)), add(p2, scale(d2, t))));
  return { s, t, distance };
}
