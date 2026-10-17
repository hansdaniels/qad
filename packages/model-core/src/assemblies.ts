import { attachPoints, type AttachPoint } from './attach.js';
import type { PartCatalog } from './catalog.js';
import type { EditCommand } from './commands.js';
import type { ConstructionSnapshot } from './core.js';
import type { Pose, Vector3 } from './geometry.js';
import type { AnchorId, FamilyId, JunctionId, PartId, PlateId, SlideId, TubeId } from './ids.js';
import { add, compose, dot, length, qaxisAngle, rotate, scale, sub, vec } from './math.js';

/** A connected assembly: everything joined by tubes, with the plates and slides on them. */
export interface Assembly {
  readonly junctionIds: readonly JunctionId[];
  readonly tubeIds: readonly TubeId[];
  readonly plateIds: readonly PlateId[];
  readonly slideIds: readonly SlideId[];
  readonly partIds: readonly PartId[];
  readonly anchorId: AnchorId | undefined;
  /** Below the junction nearest the middle of the floor plan, at the lowest height; it turns about the vertical through it. */
  readonly pivot: Vector3;
  /** Height of its lowest junction centre. */
  readonly lowest: number;
}

const Z = vec(0, 0, 1);

/** The assembly a part belongs to. */
export function assemblyOf(snapshot: ConstructionSnapshot, partId: PartId): Assembly | undefined {
  const { design, realization } = snapshot;
  const part = realization.parts.find((p) => p.id === partId);
  if (!part) return undefined;
  const intent = part.origin.intent;
  const seed =
    intent.kind === 'junction'
      ? intent.id
      : intent.kind === 'tube'
        ? design.tubes.find((t) => t.id === intent.id)?.a.junctionId
        : intent.kind === 'plate'
          ? design.plates.find((p) => p.id === intent.id)?.placement.junctionId
          : design.tubes.find((t) => t.id === design.slides.find((s) => s.id === intent.id)?.tubeId)?.a.junctionId;
  if (!seed) return undefined;
  const neighbours = new Map<JunctionId, JunctionId[]>();
  for (const t of design.tubes) {
    neighbours.set(t.a.junctionId, [...(neighbours.get(t.a.junctionId) ?? []), t.b.junctionId]);
    neighbours.set(t.b.junctionId, [...(neighbours.get(t.b.junctionId) ?? []), t.a.junctionId]);
  }
  const junctions = new Set([seed]);
  const queue = [seed];
  while (queue.length > 0) {
    for (const n of neighbours.get(queue.shift()!) ?? []) {
      if (!junctions.has(n)) {
        junctions.add(n);
        queue.push(n);
      }
    }
  }
  const tubeIds = design.tubes.filter((t) => junctions.has(t.a.junctionId)).map((t) => t.id);
  const tubes = new Set(tubeIds);
  const plateIds = design.plates.filter((p) => junctions.has(p.placement.junctionId)).map((p) => p.id);
  const slideIds = design.slides.filter((s) => tubes.has(s.tubeId)).map((s) => s.id);
  const members = new Set<string>([
    ...[...junctions].map((id) => `junction:${id}`),
    ...tubeIds.map((id) => `tube:${id}`),
    ...plateIds.map((id) => `plate:${id}`),
    ...slideIds.map((id) => `slide:${id}`),
  ]);
  const partIds = realization.parts
    .filter((p) => members.has(`${p.origin.intent.kind}:${p.origin.intent.id}`))
    .map((p) => p.id);
  const anchorId = design.anchors.find((a) =>
    a.target.kind === 'junction' ? junctions.has(a.target.id) : a.target.kind === 'tube' && tubes.has(a.target.id),
  )?.id;
  const positions = realization.intentPoses.flatMap((p) =>
    p.intent.kind === 'junction' && junctions.has(p.intent.id) ? [p.worldPose.position] : [],
  );
  const middle = scale(
    positions.reduce((s, p) => add(s, vec(p.x, p.y, 0)), vec(0, 0, 0)),
    1 / Math.max(1, positions.length),
  );
  const pivot = positions.reduce(
    (best, p) => (length(sub(vec(p.x, p.y, 0), middle)) < length(sub(vec(best.x, best.y, 0), middle)) ? p : best),
    positions[0] ?? vec(0, 0, 0),
  );
  return {
    junctionIds: [...junctions],
    tubeIds,
    plateIds,
    slideIds,
    partIds,
    anchorId,
    pivot: vec(pivot.x, pivot.y, Math.min(...positions.map((p) => p.z))),
    lowest: Math.min(...positions.map((p) => p.z)),
  };
}

/** Rigid move: quarter turns about the vertical through the pivot, then a translation, also upwards. */
export interface AssemblyMove {
  readonly translation: Vector3;
  readonly quarterTurns: number;
}

function motion(pivot: Vector3, move: AssemblyMove): Pose {
  const orientation = qaxisAngle(Z, (move.quarterTurns * Math.PI) / 2);
  return { position: add(sub(pivot, rotate(orientation, pivot)), move.translation), orientation };
}

/**
 * Command that moves an assembly by changing its anchor only: parts, IDs and
 * relations inside stay as they are (SPEC 10, scenario 8).
 */
export function moveAssembly(snapshot: ConstructionSnapshot, assembly: Assembly, move: AssemblyMove): EditCommand {
  const anchor = snapshot.design.anchors.find((a) => a.id === assembly.anchorId);
  return {
    baseRevision: snapshot.revision,
    operations: anchor
      ? [
          {
            kind: 'set-anchor',
            anchor: { ...anchor, worldPose: compose(motion(assembly.pivot, move), anchor.worldPose) },
          },
        ]
      : [],
  };
}

/** A translation at which one tube fits between a free arm of the assembly and one of another. */
export interface ConnectionSnap {
  readonly translation: Vector3;
  readonly familyId: FamilyId;
  readonly from: AttachPoint;
  readonly to: AttachPoint;
}

/**
 * Translations, for the given quarter turns, at which a free arm of the
 * assembly faces a free arm of another assembly exactly one straight standard
 * tube apart. Raising or lowering the assembly counts as well.
 */
export function connectionSnaps(
  snapshot: ConstructionSnapshot,
  catalog: PartCatalog,
  assembly: Assembly,
  quarterTurns: number,
): ConnectionSnap[] {
  const socket = catalog.partTypes
    .flatMap((t) => (t.kind === 'connector' ? t.sites : []))
    .find((s) => s.role === 'socket');
  const armOffset = socket ? length(socket.frame.position) : 0;
  const pitches = new Map<number, FamilyId>();
  for (const t of catalog.partTypes) {
    if (t.kind === 'tube' && t.shape === 'straight' && t.standardVariant)
      pitches.set(t.centerlineLengthMm + 2 * armOffset, t.familyId);
  }
  const mine = new Set(assembly.junctionIds);
  const turn = motion(assembly.pivot, { translation: vec(0, 0, 0), quarterTurns });
  const arms = attachPoints(snapshot, catalog).map((p) => {
    const out = rotate(p.worldPose.orientation, Z);
    return { point: p, centre: sub(p.worldPose.position, scale(out, armOffset)), out };
  });
  const moving = arms
    .filter((a) => mine.has(a.point.junctionId))
    .map((a) => ({
      ...a,
      centre: compose(turn, { position: a.centre, orientation: turn.orientation }).position,
      out: rotate(turn.orientation, a.out),
    }));
  const fixed = arms.filter((a) => !mine.has(a.point.junctionId));
  const snaps: ConnectionSnap[] = [];
  for (const a of moving) {
    for (const b of fixed) {
      if (dot(a.out, b.out) > -1 + 1e-9) continue;
      for (const [pitch, familyId] of pitches) {
        const translation = sub(b.centre, add(a.centre, scale(a.out, pitch)));
        snaps.push({ translation, familyId, from: a.point, to: b.point });
      }
    }
  }
  return snaps;
}
