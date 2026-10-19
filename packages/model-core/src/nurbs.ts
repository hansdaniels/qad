import type { NurbsShape } from './catalog.js';
import type { Vector3 } from './geometry.js';
import { vec } from './math.js';

/** Knot span index of t (The NURBS Book, A2.1). */
function findSpan(degree: number, knots: readonly number[], count: number, t: number): number {
  if (t >= knots[count]!) return count - 1;
  let low = degree;
  let high = count;
  let mid = Math.floor((low + high) / 2);
  while (t < knots[mid]! || t >= knots[mid + 1]!) {
    if (t < knots[mid]!) high = mid;
    else low = mid;
    mid = Math.floor((low + high) / 2);
  }
  return mid;
}

/** The degree + 1 non-zero basis functions at t (The NURBS Book, A2.2). */
function basis(span: number, t: number, degree: number, knots: readonly number[]): number[] {
  const n = [1];
  const left = [0];
  const right = [0];
  for (let j = 1; j <= degree; j++) {
    left[j] = t - knots[span + 1 - j]!;
    right[j] = knots[span + j]! - t;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const temp = n[r]! / (right[r + 1]! + left[j - r]!);
      n[r] = saved + right[r + 1]! * temp;
      saved = left[j - r]! * temp;
    }
    n[j] = saved;
  }
  return n;
}

/** Point of a rational B-spline surface at the parameters u and v (The NURBS Book, A4.3). */
export function nurbsPoint(surface: NurbsShape, u: number, v: number): Vector3 {
  const { degreeU: p, degreeV: q, knotsU, knotsV, points } = surface;
  const spanU = findSpan(p, knotsU, points.length, u);
  const spanV = findSpan(q, knotsV, points[0]!.length, v);
  const nu = basis(spanU, u, p, knotsU);
  const nv = basis(spanV, v, q, knotsV);
  let [x, y, z, w] = [0, 0, 0, 0];
  for (let k = 0; k <= p; k++) {
    for (let l = 0; l <= q; l++) {
      const point = points[spanU - p + k]![spanV - q + l]!;
      const weight = nu[k]! * nv[l]! * point.w;
      x += point.x * weight;
      y += point.y * weight;
      z += point.z * weight;
      w += weight;
    }
  }
  return vec(x / w, y / w, z / w);
}

/** Range of a parameter: from the first to the last knot that can be reached. */
export function nurbsRange(knots: readonly number[], degree: number): [number, number] {
  return [knots[degree]!, knots[knots.length - degree - 1]!];
}
