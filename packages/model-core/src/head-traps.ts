import type { PartCatalog } from './catalog.js';
import type { ConstructionSnapshot } from './core.js';
import type { Vector3 } from './geometry.js';
import type { PartId, TubeId } from './ids.js';
import { dot, length, scale, sub, transformPoint, vec } from './math.js';

/** Two parallel tubes whose gap could trap a child's head (HERSTELLERREGELN.md, section 3). */
export interface HeadTrap {
  readonly tubes: readonly [TubeId, TubeId];
  readonly partIds: readonly [PartId, PartId];
  /** Gap between the tube surfaces. */
  readonly clearWidthMm: number;
  /** Highest corner of the opening above the model's lowest point. */
  readonly heightMm: number;
}

/** Thresholds of the manufacturer's design program. */
const RULE = { parallel: 0.99, minAxisGap: 151, maxAxisGap: 299, minOverlap: 149, minHeight: 599 };
const TUBE_RADIUS = 25;

interface Axis {
  readonly tubeId: TubeId;
  readonly partId: PartId;
  readonly a: Vector3;
  readonly b: Vector3;
}

/**
 * Possible head traps after the rule of the manufacturer's design program: two
 * straight tubes, parallel, 151 to 299 mm between their axes, overlapping by more
 * than 149 mm along them, with a corner of the opening at 599 mm or higher, and
 * no plate screwed to both. Corners are the ends of the overlap on both axes;
 * heights count from the model's lowest point, taken as the floor. Not a
 * buildability finding: the model stays buildable.
 */
export function findHeadTraps(snapshot: ConstructionSnapshot, catalog: PartCatalog): HeadTrap[] {
  const types = new Map(catalog.partTypes.map((t) => [t.id, t]));
  const poses = new Map(snapshot.realization.poses.map((p) => [p.partId, p.worldPose]));
  const axes: Axis[] = [];
  // Connector bodies reach 25 from their centre, tubes 25 from their axis.
  let floor = Math.min(
    ...snapshot.realization.intentPoses.flatMap((p) =>
      p.intent.kind === 'junction' ? [p.worldPose.position.z - TUBE_RADIUS] : [],
    ),
  );
  for (const part of snapshot.realization.parts) {
    const type = types.get(part.typeId);
    const pose = poses.get(part.id);
    if (type?.kind !== 'tube' || part.origin.intent.kind !== 'tube' || !pose) continue;
    if (type.shape === 'straight') {
      const a = transformPoint(pose, vec(0, 0, 0));
      const b = transformPoint(pose, vec(type.centerlineLengthMm, 0, 0));
      axes.push({ tubeId: part.origin.intent.id, partId: part.id, a, b });
      floor = Math.min(floor, a.z - TUBE_RADIUS, b.z - TUBE_RADIUS);
    } else {
      // Curved tubes count for the floor, not as trap sides.
      for (const site of type.sites) floor = Math.min(floor, transformPoint(pose, site.frame.position).z - TUBE_RADIUS);
    }
  }
  const closed = new Set(
    snapshot.design.plates.flatMap((plate) => {
      const tubes = [...new Set(plate.mounts.map((m) => m.tubeId))].sort();
      return tubes.flatMap((x, i) => tubes.slice(i + 1).map((y) => `${x}|${y}`));
    }),
  );

  const traps: HeadTrap[] = [];
  const sorted = [...axes].sort((x, y) => compare(x.tubeId, y.tubeId));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const [p, q] = [sorted[i]!, sorted[j]!];
      const span = sub(p.b, p.a);
      const d = scale(span, 1 / length(span));
      const e = sub(q.b, q.a);
      if (Math.abs(dot(d, e)) / length(e) <= RULE.parallel) continue;
      // Distance of q's axis from p's axis; the same everywhere, as they are parallel.
      const offset = sub(q.a, p.a);
      const across = sub(offset, scale(d, dot(offset, d)));
      const gap = length(across);
      if (gap < RULE.minAxisGap || gap > RULE.maxAxisGap) continue;
      const [p0, p1] = [0, length(span)];
      const [q0, q1] = [dot(sub(q.a, p.a), d), dot(sub(q.b, p.a), d)].sort((x, y) => x - y) as [number, number];
      const [from, to] = [Math.max(p0, q0), Math.min(p1, q1)];
      if (to - from <= RULE.minOverlap) continue;
      if (closed.has(`${p.tubeId}|${q.tubeId}`)) continue;
      const corners = [from, to].flatMap((s) => {
        const onP = vec(p.a.x + d.x * s, p.a.y + d.y * s, p.a.z + d.z * s);
        return [onP, vec(onP.x + across.x, onP.y + across.y, onP.z + across.z)];
      });
      const height = Math.max(...corners.map((c) => c.z)) - floor;
      if (height < RULE.minHeight) continue;
      traps.push({
        tubes: [p.tubeId, q.tubeId],
        partIds: [p.partId, q.partId],
        clearWidthMm: gap - 2 * TUBE_RADIUS,
        heightMm: height,
      });
    }
  }
  return traps;
}

function compare(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}
