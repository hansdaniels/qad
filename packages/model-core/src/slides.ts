import type { GridDirection } from './article-catalog.js';
import { nextId } from './attach.js';
import type { PartCatalog, SlideType } from './catalog.js';
import type { EditCommand } from './commands.js';
import type { ConstructionSnapshot } from './core.js';
import type { Pose, Vector3 } from './geometry.js';
import type { ColourId, FamilyId, PartId, PartTypeId, SlideId, TubeId } from './ids.js';
import { AXIS_ROTATIONS, compose, dot, length, qconj, rotate, sub, transformPoint, vec } from './math.js';

/** A place a slide body or runout can hang: a tube and the side it runs to. */
export interface SlideSpot {
  readonly key: string;
  readonly typeId: PartTypeId;
  readonly familyId: FamilyId;
  readonly tubeId: TubeId;
  /** In the frame of the tube's junction a. */
  readonly toward: GridDirection;
  /** Slide frame: origin on the tube axis, +x away from the tube, +z up. */
  readonly worldPose: Pose;
}

const DIRECTIONS: readonly [GridDirection, Vector3][] = [
  ['+x', vec(1, 0, 0)],
  ['-x', vec(-1, 0, 0)],
  ['+y', vec(0, 1, 0)],
  ['-y', vec(0, -1, 0)],
  ['+z', vec(0, 0, 1)],
  ['-z', vec(0, 0, -1)],
];
const X = vec(1, 0, 0);
const Z = vec(0, 0, 1);

interface Hanger {
  readonly tubeId: TubeId;
  readonly partId: PartId;
  /** The tube's middle: position and axis. */
  readonly middle: Vector3;
  readonly axis: Vector3;
  readonly up: Vector3;
  readonly junction: Pose;
}

/** Straight tubes of the given length with their middle, axis and junction frame. */
function hangers(snapshot: ConstructionSnapshot, catalog: PartCatalog, lengthMm: number): Hanger[] {
  const types = new Map(catalog.partTypes.map((t) => [t.id, t]));
  const poses = new Map(snapshot.realization.poses.map((p) => [p.partId, p.worldPose]));
  const junctions = new Map(
    snapshot.realization.intentPoses.flatMap((p) => (p.intent.kind === 'junction' ? [[p.intent.id, p.worldPose]] : [])),
  );
  return snapshot.realization.parts.flatMap((part) => {
    const type = types.get(part.typeId);
    const pose = poses.get(part.id);
    const tube = snapshot.design.tubes.find(
      (t) => part.origin.intent.kind === 'tube' && t.id === part.origin.intent.id,
    );
    const junction = tube && junctions.get(tube.a.junctionId);
    const middle = type?.kind === 'tube' ? type.sites.find((s) => s.role === 'hang') : undefined;
    if (type?.kind !== 'tube' || type.nominalLengthMm !== lengthMm || !pose || !tube || !junction || !middle) return [];
    return [
      {
        tubeId: tube.id,
        partId: part.id,
        middle: compose(pose, middle.frame).position,
        axis: rotate(pose.orientation, X),
        up: rotate(junction.orientation, Z),
        junction,
      },
    ];
  });
}

/**
 * Where slides of each type can hang. A body needs a tube to rest its lower end
 * on, parallel to the one it hangs on or, for the curved body, across it; a runout
 * hangs where a body's lower end rests, running on the way the body leaves it. A
 * tube side already carrying a slide is left out.
 */
export function slideSpots(snapshot: ConstructionSnapshot, catalog: PartCatalog, toleranceMm = 1): SlideSpot[] {
  const slideTypes = catalog.partTypes.filter((t): t is SlideType => t.kind === 'slide');
  const types = new Map(catalog.partTypes.map((t) => [t.id, t]));
  const poses = new Map(snapshot.realization.poses.map((p) => [p.partId, p.worldPose]));
  const taken = new Set(snapshot.design.slides.map((s) => `${s.tubeId}|${s.toward}`));
  // Lower ends of the bodies already there, with the direction they run in.
  const lowerEnds = snapshot.realization.parts.flatMap((part) => {
    const type = types.get(part.typeId);
    const pose = poses.get(part.id);
    return type?.kind === 'slide' && type.lowerEnd && pose
      ? [{ end: transformPoint(pose, type.lowerEnd.point), toward: rotate(pose.orientation, type.lowerEnd.onward) }]
      : [];
  });
  const spots: SlideSpot[] = [];
  for (const type of slideTypes) {
    const tubes = hangers(snapshot, catalog, type.tubeLengthMm);
    for (const tube of tubes) {
      if (Math.abs(dot(tube.axis, tube.up)) > 1e-6) continue;
      for (const [direction, local] of DIRECTIONS) {
        const toward = rotate(tube.junction.orientation, local);
        if (Math.abs(dot(toward, tube.up)) > 1e-6 || Math.abs(dot(toward, tube.axis)) > 1e-6) continue;
        if (taken.has(`${tube.tubeId}|${direction}`)) continue;
        const worldPose: Pose = { position: tube.middle, orientation: upright(toward, tube.up) };
        if (type.lowerEnd) {
          const end = transformPoint(worldPose, type.lowerEnd.point);
          const axis = rotate(worldPose.orientation, type.lowerEnd.tubeAxis);
          const rests = tubes.some(
            (t) =>
              t.tubeId !== tube.tubeId &&
              length(sub(t.middle, end)) <= toleranceMm &&
              Math.abs(dot(t.axis, axis)) > 1 - 1e-6,
          );
          if (!rests) continue;
        } else {
          const below = lowerEnds.some(
            (l) => length(sub(l.end, tube.middle)) <= toleranceMm && dot(l.toward, toward) > 1 - 1e-6,
          );
          if (!below) continue;
        }
        spots.push({
          key: `${type.id}|${tube.tubeId}|${direction}`,
          typeId: type.id,
          familyId: type.familyId,
          tubeId: tube.tubeId,
          toward: direction,
          worldPose,
        });
      }
    }
  }
  return spots;
}

/** The grid rotation with x along toward and z along up. */
function upright(toward: Vector3, up: Vector3) {
  return AXIS_ROTATIONS.reduce((best, r) =>
    dot(rotate(r, X), toward) + dot(rotate(r, Z), up) > dot(rotate(best, X), toward) + dot(rotate(best, Z), up)
      ? r
      : best,
  );
}

/** Command that hangs a slide at a spot. */
export function insertSlide(snapshot: ConstructionSnapshot, spot: SlideSpot, colour: ColourId): EditCommand {
  const id: SlideId = nextId(
    's',
    snapshot.design.slides.map((s) => s.id),
  );
  return {
    baseRevision: snapshot.revision,
    operations: [
      {
        kind: 'add-slide',
        slide: { id, familyId: spot.familyId, tubeId: spot.tubeId, toward: spot.toward, appearance: { colour } },
      },
    ],
  };
}

/** A world direction in the frame of the tube's junction a, as a slide's toward; undefined off the grid. */
export function localToward(snapshot: ConstructionSnapshot, tubeId: TubeId, world: GridDirection) {
  const tube = snapshot.design.tubes.find((t) => t.id === tubeId);
  const junction = snapshot.realization.intentPoses.find(
    (p) => p.intent.kind === 'junction' && p.intent.id === tube?.a.junctionId,
  )?.worldPose;
  if (!junction) return undefined;
  const v = rotate(qconj(junction.orientation), DIRECTIONS.find(([d]) => d === world)![1]);
  return DIRECTIONS.find(([, u]) => dot(u, v) > 1 - 1e-6)?.[0];
}

/** Points where slide bodies end below, in world coordinates. */
export function slideEnds(
  snapshot: ConstructionSnapshot,
  catalog: PartCatalog,
  slideIds: ReadonlySet<SlideId>,
): Vector3[] {
  const types = new Map(catalog.partTypes.map((t) => [t.id, t]));
  const poses = new Map(snapshot.realization.poses.map((p) => [p.partId, p.worldPose]));
  return snapshot.realization.parts.flatMap((part) => {
    const type = types.get(part.typeId);
    const pose = poses.get(part.id);
    return part.origin.intent.kind === 'slide' && slideIds.has(part.origin.intent.id) && type?.kind === 'slide'
      ? pose && type.lowerEnd
        ? [transformPoint(pose, type.lowerEnd.point)]
        : []
      : [];
  });
}

/** Tubes the lower ends of the slides rest on. */
export function restingTubes(
  snapshot: ConstructionSnapshot,
  catalog: PartCatalog,
  slideIds: ReadonlySet<SlideId>,
  toleranceMm = 1,
): TubeId[] {
  const ends = slideEnds(snapshot, catalog, slideIds);
  const lengths = new Set(catalog.partTypes.flatMap((t) => (t.kind === 'slide' && t.lowerEnd ? [t.tubeLengthMm] : [])));
  return [...lengths].flatMap((lengthMm) =>
    hangers(snapshot, catalog, lengthMm)
      .filter((t) => ends.some((end) => length(sub(t.middle, end)) <= toleranceMm))
      .map((t) => t.tubeId),
  );
}
