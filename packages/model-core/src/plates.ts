import type { PartCatalog, PlateType, TubeType } from './catalog.js';
import type { EditCommand } from './commands.js';
import type { ConstructionSnapshot } from './core.js';
import type { PlateMountIntent } from './design.js';
import type { Pose, Vector3 } from './geometry.js';
import type { ColourId, FamilyId, JunctionId, PartId, PartTypeId, PlateId, TubeId } from './ids.js';
import { nextId } from './attach.js';
import { AXIS_ROTATIONS, add, compose, cross, dot, inverse, length, qconj, rotate, scale, sub, vec } from './math.js';

/** A grid cell where a plate of a type fits, with its side and flange direction. */
export interface PlateSpot {
  /** Stable while the cell exists: corners, type, flange tubes and side. */
  readonly key: string;
  /** Same for both flange directions of one cell side. */
  readonly cellKey: string;
  readonly typeId: PartTypeId;
  readonly familyId: FamilyId;
  readonly junctionId: JunctionId;
  /** Plate frame in the frame of junctionId. */
  readonly pose: Pose;
  readonly worldPose: Pose;
  /** The two tubes the flanges are screwed to. */
  readonly flangeTubes: readonly [TubeId, TubeId];
  readonly mounts: readonly PlateMountIntent[];
}

const X = vec(1, 0, 0);
const Z = vec(0, 0, 1);

interface Side {
  readonly tubeId: TubeId;
  readonly other: JunctionId;
  /** Unit direction and length in world coordinates. */
  readonly direction: Vector3;
  readonly lengthMm: number;
}

/**
 * Cells of four straight tubes forming a rectangle that matches a plate type,
 * on both sides of the cell and for each flange direction the type allows.
 * A side already holding a plate is left out.
 */
export function plateSpots(snapshot: ConstructionSnapshot, catalog: PartCatalog, toleranceMm = 1): PlateSpot[] {
  const { design, realization } = snapshot;
  const types = new Map(catalog.partTypes.map((t) => [t.id, t]));
  const plateTypes = catalog.partTypes.filter((t): t is PlateType => t.kind === 'plate');
  const junctionPose = new Map(
    realization.intentPoses.flatMap((p) => (p.intent.kind === 'junction' ? [[p.intent.id, p.worldPose] as const] : [])),
  );
  const tubeBody = new Map(
    realization.parts.flatMap((p) =>
      p.origin.intent.kind === 'tube' && p.origin.role === 'body' ? [[p.origin.intent.id, p] as const] : [],
    ),
  );
  const tubePose = new Map(realization.poses.map((p) => [p.partId, p.worldPose]));
  const straight = (tubeId: TubeId) => {
    const body = tubeBody.get(tubeId);
    const type = body && types.get(body.typeId);
    return type?.kind === 'tube' && type.shape === 'straight';
  };
  const sides = new Map<JunctionId, Side[]>();
  for (const tube of design.tubes) {
    const [pa, pb] = [junctionPose.get(tube.a.junctionId), junctionPose.get(tube.b.junctionId)];
    if (!pa || !pb || !straight(tube.id)) continue;
    const delta = sub(pb.position, pa.position);
    const lengthMm = length(delta);
    const direction = scale(delta, 1 / lengthMm);
    sides.set(tube.a.junctionId, [
      ...(sides.get(tube.a.junctionId) ?? []),
      { tubeId: tube.id, other: tube.b.junctionId, direction, lengthMm },
    ]);
    sides.set(tube.b.junctionId, [
      ...(sides.get(tube.b.junctionId) ?? []),
      { tubeId: tube.id, other: tube.a.junctionId, direction: scale(direction, -1), lengthMm },
    ]);
  }
  const between = (from: JunctionId, to: JunctionId) => sides.get(from)?.find((s) => s.other === to);
  const occupied = realization.parts
    .filter((p) => p.origin.intent.kind === 'plate')
    .flatMap((p) => {
      const pose = tubePose.get(p.id);
      return pose ? [{ centre: pose.position, normal: rotate(pose.orientation, Z) }] : [];
    });

  const spots: PlateSpot[] = [];
  const seen = new Set<string>();
  for (const corner of [...sides.keys()].sort()) {
    const frame = junctionPose.get(corner)!;
    const out = sides.get(corner)!;
    for (const u of out) {
      for (const v of out) {
        if (u === v || Math.abs(dot(u.direction, v.direction)) > 1e-6) continue;
        // Far corner reached over both remaining sides.
        const far = sides.get(u.other)?.find((s) => {
          const opposite = between(v.other, s.other);
          return s.other !== corner && dot(s.direction, v.direction) > 1 - 1e-6 && opposite !== undefined;
        });
        if (!far) continue;
        const last = between(v.other, far.other)!;
        if (dot(last.direction, u.direction) < 1 - 1e-6) continue;
        const corners = [corner, u.other, far.other, v.other];
        const cellId = [...corners].sort().join('+');
        if (seen.has(`${cellId}|${u.tubeId}|${v.tubeId}`)) continue;
        seen.add(`${cellId}|${u.tubeId}|${v.tubeId}`);
        seen.add(`${cellId}|${v.tubeId}|${u.tubeId}`);
        // u × v and its opposite are the two sides; each spot is generated once per cell.
        if (corner !== [...corners].sort()[0]) continue;
        const centre = add(frame.position, add(scale(u.direction, u.lengthMm / 2), scale(v.direction, v.lengthMm / 2)));
        for (const type of plateTypes) {
          for (const [along, across, flanges] of [
            [u, v, [u.tubeId, last.tubeId]],
            [v, u, [v.tubeId, far.tubeId]],
          ] as const) {
            const [cx, cy] = type.cellMm;
            if (Math.abs(along.lengthMm - cx) > toleranceMm || Math.abs(across.lengthMm - cy) > toleranceMm) continue;
            for (const sign of [1, -1]) {
              const normal = scale(cross(u.direction, v.direction), sign);
              if (occupied.some((p) => length(sub(p.centre, centre)) <= toleranceMm && dot(p.normal, normal) > 0.5))
                continue;
              const local = (w: Vector3) => rotate(qconj(frame.orientation), w);
              const orientation = AXIS_ROTATIONS.find(
                (r) =>
                  dot(rotate(r, X), local(along.direction)) > 1 - 1e-6 && dot(rotate(r, Z), local(normal)) > 1 - 1e-6,
              );
              if (!orientation) continue;
              const pose = { position: local(sub(centre, frame.position)), orientation };
              const worldPose = compose(frame, pose);
              const mounts = mountsOf(type, worldPose, flanges, design.tubes, tubeBody, tubePose, types, toleranceMm);
              if (!mounts) continue;
              const cellKey = `${cellId}|${type.id}|${normalKey(normal)}`;
              spots.push({
                key: `${cellKey}|${flanges[0]}`,
                cellKey,
                typeId: type.id,
                familyId: type.familyId,
                junctionId: corner,
                pose,
                worldPose,
                flangeTubes: flanges,
                mounts,
              });
            }
          }
        }
      }
    }
  }
  return spots.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Normal rounded to a short axis label, so the key does not depend on float noise. */
function normalKey(n: Vector3): string {
  const r = (x: number) => (Math.abs(x) < 1e-6 ? '0' : x > 0 ? '+' : '-');
  return `${r(n.x)}${r(n.y)}${r(n.z)}`;
}

/** Mount per required plate site on whichever flange tube carries it, with its station. */
function mountsOf(
  type: PlateType,
  worldPose: Pose,
  flanges: readonly TubeId[],
  tubes: ConstructionSnapshot['design']['tubes'],
  tubeBody: ReadonlyMap<TubeId, { id: PartId; typeId: PartTypeId }>,
  tubePose: ReadonlyMap<PartId, Pose>,
  types: ReadonlyMap<string, unknown>,
  toleranceMm: number,
): PlateMountIntent[] | undefined {
  const mounts: PlateMountIntent[] = [];
  for (const siteId of type.requiredMounts) {
    const site = type.sites.find((s) => s.id === siteId);
    if (!site) return undefined;
    const point = compose(worldPose, site.frame).position;
    const hit = flanges.flatMap((tubeId) => {
      const body = tubeBody.get(tubeId);
      const pose = body && tubePose.get(body.id);
      const tubeType = body && (types.get(body.typeId) as TubeType | undefined);
      const start = tubeType?.sites.find((s) => s.id === tubeType.ends.a);
      if (!tubes.some((t) => t.id === tubeId) || !pose || !start) return [];
      const local = compose(inverse(compose(pose, start.frame)), { position: point, orientation: pose.orientation });
      // End site a: +Z points out of the tube, so the station runs along -Z.
      const station = -local.position.z;
      const lateral = Math.hypot(local.position.x, local.position.y);
      return lateral <= toleranceMm ? [{ tubeId, station }] : [];
    })[0];
    if (!hit) return undefined;
    mounts.push({
      plateSiteId: siteId,
      tubeId: hit.tubeId,
      stationMm: Math.round(hit.station * 1000) / 1000,
      hole: { mode: 'automatic' },
    });
  }
  return mounts;
}

/** Command that inserts a plate at a spot. */
export function insertPlate(snapshot: ConstructionSnapshot, spot: PlateSpot, colour: ColourId): EditCommand {
  const id: PlateId = nextId(
    'p',
    snapshot.design.plates.map((p) => p.id),
  );
  return {
    baseRevision: snapshot.revision,
    operations: [
      {
        kind: 'add-plate',
        plate: {
          id,
          familyId: spot.familyId,
          variant: { mode: 'automatic' },
          placement: { junctionId: spot.junctionId, pose: spot.pose },
          mounts: spot.mounts,
          appearance: { colour },
        },
      },
    ],
  };
}
