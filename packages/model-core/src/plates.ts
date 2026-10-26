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

/** A straight tube as a possible flange: its middle, axis, span and the junctions on its axis. */
interface Flange {
  readonly tubeId: TubeId;
  readonly middle: Vector3;
  readonly axis: Vector3;
  /** Distance between the junction centres of a cell along the tube. */
  readonly spanMm: number;
  readonly junctions: readonly JunctionId[];
}

/**
 * Places for a plate between two parallel straight tubes it is screwed to, its
 * flange tubes: as far apart as the plate type's cell is wide, ends level, on
 * both sides of their plane and for each flange direction the type allows; a
 * half plate also with its flanges on the short sides. The cross sides need no
 * tube, so a plate also fits between two rafters whose feet sit on angle
 * adapters. A side already holding a plate is left out, except the side of plate except.
 */
export function plateSpots(
  snapshot: ConstructionSnapshot,
  catalog: PartCatalog,
  toleranceMm = 1,
  except?: PlateId,
): PlateSpot[] {
  const { design, realization } = snapshot;
  const types = new Map(catalog.partTypes.map((t) => [t.id, t]));
  // Bent variants follow from the neighbours; the solver picks them.
  const plateTypes = catalog.partTypes.filter((t): t is PlateType => t.kind === 'plate' && !t.folded);
  const junctionPose = new Map(
    realization.intentPoses.flatMap((p) => (p.intent.kind === 'junction' ? [[p.intent.id, p.worldPose] as const] : [])),
  );
  const tubeBody = new Map(
    realization.parts.flatMap((p) =>
      p.origin.intent.kind === 'tube' && p.origin.role === 'body' ? [[p.origin.intent.id, p] as const] : [],
    ),
  );
  const tubePose = new Map(realization.poses.map((p) => [p.partId, p.worldPose]));
  const flanges: Flange[] = design.tubes.flatMap((tube) => {
    const body = tubeBody.get(tube.id);
    const type = body && types.get(body.typeId);
    const pose = body && tubePose.get(body.id);
    if (type?.kind !== 'tube' || type.shape !== 'straight' || !pose) return [];
    const axis = rotate(pose.orientation, X);
    const middle = compose(pose, {
      position: scale(X, type.centerlineLengthMm / 2),
      orientation: pose.orientation,
    }).position;
    // Junctions on the tube's axis; the foot of an oblique tube sits beside it, on an angle adapter.
    const junctions = [tube.a.junctionId, tube.b.junctionId].filter((id) => {
      const at = junctionPose.get(id);
      return at !== undefined && length(cross(axis, sub(at.position, middle))) <= toleranceMm;
    });
    const at = junctions[0] && junctionPose.get(junctions[0]);
    return at ? [{ tubeId: tube.id, middle, axis, spanMm: 2 * length(sub(at.position, middle)), junctions }] : [];
  });
  const occupied = realization.parts
    .filter((p) => p.origin.intent.kind === 'plate' && p.origin.intent.id !== except)
    .flatMap((p) => {
      const pose = tubePose.get(p.id);
      return pose ? [{ centre: pose.position, normal: rotate(pose.orientation, Z) }] : [];
    });

  const spots: PlateSpot[] = [];
  for (const [i, first] of flanges.entries()) {
    for (const second of flanges.slice(i + 1)) {
      if (Math.abs(dot(first.axis, second.axis)) < 1 - 1e-6) continue;
      if (Math.abs(first.spanMm - second.spanMm) > toleranceMm) continue;
      const apart = sub(second.middle, first.middle);
      // Ends level: the flange tubes lie side by side, not staggered.
      if (Math.abs(dot(apart, first.axis)) > toleranceMm) continue;
      const widthMm = length(apart);
      if (widthMm <= toleranceMm) continue;
      const across = scale(apart, 1 / widthMm);
      const centre = add(first.middle, scale(apart, 0.5));
      const pair: readonly [TubeId, TubeId] = [first.tubeId, second.tubeId];
      const corners = [...first.junctions, ...second.junctions].sort();
      for (const type of plateTypes) {
        const [cx, cy] = type.cellMm;
        if (Math.abs(first.spanMm - cx) > toleranceMm || Math.abs(widthMm - cy) > toleranceMm) continue;
        for (const sign of [1, -1]) {
          const normal = scale(cross(first.axis, across), sign);
          if (occupied.some((p) => length(sub(p.centre, centre)) <= toleranceMm && dot(p.normal, normal) > 0.5))
            continue;
          // Placed in the frame of a junction whose grid the plate follows.
          const placed = corners.flatMap((junctionId) => {
            const frame = junctionPose.get(junctionId)!;
            const local = (w: Vector3) => rotate(qconj(frame.orientation), w);
            const orientation = AXIS_ROTATIONS.find(
              (r) => dot(rotate(r, X), local(first.axis)) > 1 - 1e-6 && dot(rotate(r, Z), local(normal)) > 1 - 1e-6,
            );
            return orientation
              ? [{ junctionId, frame, pose: { position: local(sub(centre, frame.position)), orientation } }]
              : [];
          })[0];
          if (!placed) continue;
          const worldPose = compose(placed.frame, placed.pose);
          const mounts = mountsOf(type, worldPose, pair, design.tubes, tubeBody, tubePose, types, toleranceMm);
          if (!mounts) continue;
          // Per family and place: a half plate's flanges on the long or the short sides are alternatives like flange directions.
          // A full cell goes by its four corners, a place without them, e.g. between rafters, by where it is.
          const place = corners.length === 4 ? corners.join('+') : placeKey(centre);
          const cellKey = `${place}|${type.familyId}|${normalKey(normal)}`;
          spots.push({
            key: `${cellKey}|${[...pair].sort()[0]}`,
            cellKey,
            typeId: type.id,
            familyId: type.familyId,
            junctionId: placed.junctionId,
            pose: placed.pose,
            worldPose,
            flangeTubes: pair,
            mounts,
          });
        }
      }
    }
  }
  return spots.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Middle of a plate place rounded to whole millimetres, so the key does not depend on float noise. */
function placeKey(p: Vector3): string {
  return [p.x, p.y, p.z].map((v) => Math.round(v) + 0).join('/');
}

/** Normal rounded to a short label of signs, so the key does not depend on float noise. */
function normalKey(n: Vector3): string {
  const r = (x: number) => (Math.abs(x) < 1e-3 ? '0' : x > 0 ? '+' : '-');
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

/**
 * Commands that turn an existing plate to the other flange directions on its cell
 * side, keeping its ID and colour.
 */
export function turnPlate(snapshot: ConstructionSnapshot, plateId: PlateId, catalog: PartCatalog): EditCommand[] {
  const plate = snapshot.design.plates.find((p) => p.id === plateId);
  const body = snapshot.realization.parts.find(
    (p) => p.origin.intent.kind === 'plate' && p.origin.intent.id === plateId,
  );
  const pose = body && snapshot.realization.poses.find((p) => p.partId === body.id)?.worldPose;
  if (!plate || !body || !pose) return [];
  const normal = rotate(pose.orientation, Z);
  const tubes = new Set(plate.mounts.map((m) => m.tubeId));
  return plateSpots(snapshot, catalog, 1, plateId)
    .filter(
      (s) =>
        s.familyId === plate.familyId &&
        length(sub(s.worldPose.position, pose.position)) <= 1 &&
        dot(rotate(s.worldPose.orientation, Z), normal) > 0.5 &&
        !s.flangeTubes.every((t) => tubes.has(t)),
    )
    .map((spot) => ({
      baseRevision: snapshot.revision,
      operations: [
        {
          kind: 'set-plate',
          plate: { ...plate, placement: { junctionId: spot.junctionId, pose: spot.pose }, mounts: spot.mounts },
        },
      ],
    }));
}
