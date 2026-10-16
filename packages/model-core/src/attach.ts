import type { GridDirection } from './article-catalog.js';
import type { PartCatalog, TubeType } from './catalog.js';
import type { DesignOperation, EditCommand } from './commands.js';
import type { ConstructionSnapshot } from './core.js';
import type { ConstructionDesign } from './design.js';
import type { ColourId, FamilyId, JunctionId } from './ids.js';
import type { Pose, Quaternion, Vector3 } from './geometry.js';
import {
  AXIS_ROTATIONS,
  add,
  compose,
  dot,
  length,
  qconj,
  qmul,
  rotate,
  scale,
  sub,
  transformPoint,
  vec,
} from './math.js';

/** A free axis direction at a junction, where the editor offers a virtual arm. */
export interface AttachPoint {
  readonly junctionId: JunctionId;
  /** In the junction frame. */
  readonly direction: GridDirection;
  /** Arm frame in world coordinates: origin at the arm shoulder, +Z outwards. */
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
const Z = vec(0, 0, 1);

/** Axis-aligned rotation taking +Z onto the direction. */
export function towardDirection(direction: GridDirection): Quaternion {
  const target = DIRECTIONS.find(([d]) => d === direction)![1];
  return AXIS_ROTATIONS.find((r) => dot(rotate(r, Z), target) > 1 - 1e-9)!;
}

const opposite = (d: GridDirection): GridDirection => ((d[0] === '+' ? '-' : '+') + d[1]) as GridDirection;
const unit = (d: GridDirection): Vector3 => DIRECTIONS.find(([x]) => x === d)![1];

/** The four directions a curved tube leaving along d can bend to, upwards first. */
export function bendDirections(direction: GridDirection): GridDirection[] {
  const order: GridDirection[] = ['+z', '+x', '+y', '-x', '-y', '-z'];
  return order.filter((d) => d[1] !== direction[1]);
}

/** Rotation whose x, y and z axes are the given orthonormal vectors. */
function basis(x: Vector3, y: Vector3): Quaternion {
  return AXIS_ROTATIONS.find(
    (r) => dot(rotate(r, vec(1, 0, 0)), x) > 1 - 1e-9 && dot(rotate(r, vec(0, 1, 0)), y) > 1 - 1e-9,
  )!;
}

const FLIP_Z: Quaternion = { x: 1, y: 0, z: 0, w: 0 };

/**
 * Free directions at every placed junction, also a lone anchored one. Occupied are the axes of
 * tube ends and the arms that carry angle adapters. The auto connector adds the
 * arm when a tube is attached, so a virtual arm is not a physical one.
 */
export function attachPoints(snapshot: ConstructionSnapshot, catalog: PartCatalog): AttachPoint[] {
  const { design, realization } = snapshot;
  const socket = catalog.partTypes
    .flatMap((t) => (t.kind === 'connector' ? t.sites : []))
    .find((s) => s.role === 'socket');
  const armOffset = socket ? length(socket.frame.position) : 0;
  const types = new Map(catalog.partTypes.map((t) => [t.id, t]));
  const points: AttachPoint[] = [];
  for (const junction of [...design.junctions].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const frame = realization.intentPoses.find(
      (p) => p.intent.kind === 'junction' && p.intent.id === junction.id,
    )?.worldPose;
    const ends = design.tubes.flatMap((t) =>
      (['a', 'b'] as const).filter((e) => t[e].junctionId === junction.id).map((e) => t[e]),
    );
    if (!frame) continue;
    const occupied = ends.map((e) => rotate(e.orientation, Z));
    // Arms carrying an angle adapter, expressed in the junction frame.
    const connector = realization.parts.find(
      (p) => p.origin.intent.kind === 'junction' && p.origin.intent.id === junction.id && p.origin.role === 'connector',
    );
    const connectorPose = connector && realization.poses.find((p) => p.partId === connector.id)?.worldPose;
    const connectorType = connector && types.get(connector.typeId);
    for (const c of realization.connections) {
      if (!connector || !connectorPose || !connectorType) break;
      const armRef = c.a.partId === connector.id ? c.a : c.b.partId === connector.id ? c.b : undefined;
      const other = armRef === c.a ? c.b : c.a;
      const adapter =
        armRef && realization.parts.find((p) => p.id === other.partId && p.origin.role.startsWith('angle-adapter'));
      const site = adapter && connectorType.sites.find((s) => s.id === armRef.siteId);
      if (!site) continue;
      const world = rotate(compose(connectorPose, site.frame).orientation, Z);
      occupied.push(rotate(qconj(frame.orientation), world));
    }
    for (const [direction, axis] of DIRECTIONS) {
      if (occupied.some((o) => dot(o, axis) > 1 - 1e-6)) continue;
      const orientation = qmul(frame.orientation, towardDirection(direction));
      points.push({
        junctionId: junction.id,
        direction,
        worldPose: compose(
          { position: frame.position, orientation },
          { position: vec(0, 0, armOffset), orientation: { x: 0, y: 0, z: 0, w: 1 } },
        ),
      });
    }
  }
  return points;
}

/** Next free ID of the form prefix + number. */
export function nextId(prefix: string, existing: readonly string[]): string {
  let n = 1;
  for (const id of existing) {
    const match = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (match) n = Math.max(n, Number(match[1]) + 1);
  }
  return `${prefix}${n}`;
}

export interface AttachOptions {
  /** Distance within which the far end joins an existing junction; default 1 mm. */
  readonly toleranceMm?: number;
  /** Curved tube: the perpendicular direction it bends towards. */
  readonly bend?: GridDirection;
  /**
   * Straight tube on an angle adapter on the arm: the perpendicular direction the
   * tube leans to. It leaves at 45° back over the connector (GEOMETRIE.md, section 3).
   */
  readonly oblique?: GridDirection;
}

/**
 * Command that attaches a tube at a free direction. Where the far end of an axial
 * tube meets an existing junction point, the tube joins it and closes the ring;
 * the auto connector there follows from the solver. Otherwise a new junction is
 * added; an oblique tube always ends at a new one.
 */
export function attachTube(
  snapshot: ConstructionSnapshot,
  at: { readonly junctionId: JunctionId; readonly direction: GridDirection },
  tube: { readonly familyId: FamilyId; readonly colour: ColourId },
  catalog: PartCatalog,
  options: AttachOptions = {},
): EditCommand {
  const { toleranceMm = 1, bend, oblique } = options;
  const { design } = snapshot;
  const tubeId = nextId(
    't',
    design.tubes.map((t) => t.id),
  );
  const type = catalog.partTypes.find(
    (t): t is TubeType => t.kind === 'tube' && t.familyId === tube.familyId && t.standardVariant,
  );
  if (type?.shape === 'bent') return attachCurvedTube(snapshot, at, tube, type, catalog, bend, toleranceMm, tubeId);
  if (oblique) return attachObliqueTube(snapshot, at, tube, oblique, tubeId);
  const existing = farEndJunction(snapshot, at, tube.familyId, catalog, toleranceMm);
  const junctionId =
    existing ??
    nextId(
      'j',
      design.junctions.map((j) => j.id),
    );
  return {
    baseRevision: snapshot.revision,
    operations: [
      ...(existing ? [] : [{ kind: 'add-junction', junction: { id: junctionId } } as const]),
      ...(existing ? joinAssemblies(design, at.junctionId, existing) : []),
      {
        kind: 'add-tube',
        tube: {
          id: tubeId,
          familyId: tube.familyId,
          a: { junctionId: at.junctionId, orientation: towardDirection(at.direction), roll: { mode: 'free' } },
          b: { junctionId, orientation: towardDirection(opposite(at.direction)), roll: { mode: 'free' } },
          variant: { mode: 'automatic' },
          appearance: { colour: tube.colour },
        },
      },
    ],
  };
}

/** The perpendicular directions an oblique tube on an angle adapter can lean to. */
export function obliqueDirections(direction: GridDirection): GridDirection[] {
  return bendDirections(direction);
}

/** Rotation taking +Z onto the unit vector v. */
function zOnto(v: Vector3): Quaternion {
  const z = vec(0, 0, 1);
  const c = dot(z, v);
  if (c > 1 - 1e-12) return { x: 0, y: 0, z: 0, w: 1 };
  if (c < -1 + 1e-12) return { x: 1, y: 0, z: 0, w: 0 };
  const axis = vec(-v.y, v.x, 0);
  const s = Math.sqrt((1 + c) / 2);
  const k = Math.sqrt((1 - c) / 2) / length(axis);
  return { x: axis.x * k, y: axis.y * k, z: axis.z * k, w: s };
}

/**
 * A straight tube on an angle adapter on the arm at direction: it leaves at 135°
 * to the arm, leaning towards lean, and ends at a new junction.
 */
function attachObliqueTube(
  snapshot: ConstructionSnapshot,
  at: { readonly junctionId: JunctionId; readonly direction: GridDirection },
  tube: { readonly familyId: FamilyId; readonly colour: ColourId },
  lean: GridDirection,
  tubeId: string,
): EditCommand {
  const [arm, side] = [unit(at.direction), unit(lean)];
  if (Math.abs(dot(arm, side)) > 1e-9) return { baseRevision: snapshot.revision, operations: [] };
  const d = scale(add(scale(arm, -1), side), Math.SQRT1_2);
  const junctionId = nextId(
    'j',
    snapshot.design.junctions.map((j) => j.id),
  );
  return {
    baseRevision: snapshot.revision,
    operations: [
      { kind: 'add-junction', junction: { id: junctionId } },
      {
        kind: 'add-tube',
        tube: {
          id: tubeId,
          familyId: tube.familyId,
          a: { junctionId: at.junctionId, orientation: zOnto(d), roll: { mode: 'free' }, adapterArm: at.direction },
          b: { junctionId, orientation: zOnto(scale(d, -1)), roll: { mode: 'free' } },
          variant: { mode: 'automatic' },
          appearance: { colour: tube.colour },
        },
      },
    ],
  };
}

/**
 * A curved tube in the plane of direction and bend. Its end frames carry the
 * bending plane, so the solver also finds it at open ends, where no connector
 * offers turns to try.
 */
function attachCurvedTube(
  snapshot: ConstructionSnapshot,
  at: { readonly junctionId: JunctionId; readonly direction: GridDirection },
  tube: { readonly familyId: FamilyId; readonly colour: ColourId },
  type: TubeType,
  catalog: PartCatalog,
  bend: GridDirection | undefined,
  toleranceMm: number,
  tubeId: string,
): EditCommand {
  const { design, realization } = snapshot;
  const toward = bend ?? bendDirections(at.direction)[0]!;
  const [d, b] = [unit(at.direction), unit(toward)];
  if (Math.abs(dot(d, b)) > 1e-9) return { baseRevision: snapshot.revision, operations: [] };
  const socket = catalog.partTypes
    .flatMap((t) => (t.kind === 'connector' ? t.sites : []))
    .find((s) => s.role === 'socket');
  const armOffset = socket ? length(socket.frame.position) : 0;
  // Tube frame in the junction frame: origin at the end a face, x along d, y towards the bend.
  const frame = { position: scale(d, armOffset), orientation: basis(d, b) };
  const site = (end: 'a' | 'b') => type.sites.find((s) => s.id === type.ends[end])!;
  const into = (end: 'a' | 'b') => qmul(frame.orientation, qmul(site(end).frame.orientation, FLIP_Z));
  const endB = compose(frame, site('b').frame);
  const farLocal = add(endB.position, scale(rotate(endB.orientation, vec(0, 0, 1)), armOffset));

  const poses = realization.intentPoses.filter((p) => p.intent.kind === 'junction');
  const start = poses.find((p) => p.intent.id === at.junctionId)?.worldPose;
  const target = start && transformPoint(start, farLocal);
  const existing =
    target &&
    poses.find((p) => p.intent.id !== at.junctionId && length(sub(p.worldPose.position, target)) <= toleranceMm);
  const junctionId =
    existing?.intent.id ??
    nextId(
      'j',
      design.junctions.map((j) => j.id),
    );
  // Orientation at end b in the far junction's frame; a new junction takes the start frame.
  const bOrientation =
    existing && start ? qmul(qconj(existing.worldPose.orientation), qmul(start.orientation, into('b'))) : into('b');
  return {
    baseRevision: snapshot.revision,
    operations: [
      ...(existing ? [] : [{ kind: 'add-junction', junction: { id: junctionId } } as const]),
      ...(existing ? joinAssemblies(design, at.junctionId, existing.intent.id) : []),
      {
        kind: 'add-tube',
        tube: {
          id: tubeId,
          familyId: tube.familyId,
          a: { junctionId: at.junctionId, orientation: into('a'), roll: { mode: 'free' } },
          b: { junctionId, orientation: bOrientation, roll: { mode: 'free' } },
          variant: { mode: 'automatic' },
          appearance: { colour: tube.colour },
        },
      },
    ],
  };
}

/**
 * When a tube joins two separate assemblies, the one it reaches gives up its
 * anchor: it already lies where the tube ends, and one assembly has one anchor.
 */
function joinAssemblies(design: ConstructionDesign, from: JunctionId, to: JunctionId): DesignOperation[] {
  const neighbours = new Map<JunctionId, JunctionId[]>();
  for (const t of design.tubes) {
    neighbours.set(t.a.junctionId, [...(neighbours.get(t.a.junctionId) ?? []), t.b.junctionId]);
    neighbours.set(t.b.junctionId, [...(neighbours.get(t.b.junctionId) ?? []), t.a.junctionId]);
  }
  const reached = new Set([to]);
  const queue = [to];
  while (queue.length > 0) {
    for (const n of neighbours.get(queue.shift()!) ?? []) {
      if (!reached.has(n)) {
        reached.add(n);
        queue.push(n);
      }
    }
  }
  if (reached.has(from)) return [];
  const tubes = new Set(design.tubes.filter((t) => reached.has(t.a.junctionId)).map((t) => t.id));
  return design.anchors
    .filter((a) =>
      a.target.kind === 'junction' ? reached.has(a.target.id) : a.target.kind === 'tube' && tubes.has(a.target.id),
    )
    .map((a): DesignOperation => ({ kind: 'remove-anchor', id: a.id }));
}

/**
 * Existing junction where the far end of a straight tube of the family lands:
 * centre distance is the tube length between its end faces plus one arm length
 * at each end.
 */
function farEndJunction(
  snapshot: ConstructionSnapshot,
  at: { readonly junctionId: JunctionId; readonly direction: GridDirection },
  familyId: FamilyId,
  catalog: PartCatalog,
  toleranceMm: number,
): JunctionId | undefined {
  const type = catalog.partTypes.find((t) => t.kind === 'tube' && t.familyId === familyId && t.standardVariant);
  if (type?.kind !== 'tube' || type.shape !== 'straight') return undefined;
  const ends = [type.ends.a, type.ends.b].map((id) => type.sites.find((s) => s.id === id)?.frame.position);
  if (!ends[0] || !ends[1]) return undefined;
  const socket = catalog.partTypes
    .flatMap((t) => (t.kind === 'connector' ? t.sites : []))
    .find((s) => s.role === 'socket');
  const pitch = length(sub(ends[1], ends[0])) + 2 * (socket ? length(socket.frame.position) : 0);
  const poses = snapshot.realization.intentPoses.filter((p) => p.intent.kind === 'junction');
  const start = poses.find((p) => p.intent.id === at.junctionId)?.worldPose;
  if (!start) return undefined;
  const direction = rotate(qmul(start.orientation, towardDirection(at.direction)), Z);
  const target = add(start.position, scale(direction, pitch));
  return poses.find((p) => p.intent.id !== at.junctionId && length(sub(p.worldPose.position, target)) <= toleranceMm)
    ?.intent.id;
}

/**
 * Commands that put an existing tube into its other positions on the same arm,
 * keeping its ID and colour, in turning order after the current one: a curved
 * tube bends the other ways; a straight tube whose far end holds nothing else
 * changes between axial and the four oblique positions on an angle adapter. A
 * far junction left without tubes goes, unless anchored.
 */
export function turnTube(snapshot: ConstructionSnapshot, tubeId: string, catalog: PartCatalog): EditCommand[] {
  const { design, realization } = snapshot;
  const tube = design.tubes.find((t) => t.id === tubeId);
  const type = catalog.partTypes.find(
    (t): t is TubeType => t.kind === 'tube' && t.familyId === tube?.familyId && t.standardVariant,
  );
  const frame = (id: JunctionId) =>
    realization.intentPoses.find((p) => p.intent.kind === 'junction' && p.intent.id === id)?.worldPose;
  const [start, far] = tube ? [frame(tube.a.junctionId), frame(tube.b.junctionId)] : [];
  if (!tube || !type || !start || !far) return [];
  const grid = (v: Vector3) => DIRECTIONS.find(([, u]) => dot(u, v) > 1 - 1e-6)?.[0];
  const out = rotate(tube.a.orientation, vec(0, 0, 1));
  const farId = tube.b.junctionId;
  const keepFar =
    design.tubes.some((t) => t.id !== tubeId && (t.a.junctionId === farId || t.b.junctionId === farId)) ||
    design.anchors.some((a) => a.target.kind === 'junction' && a.target.id === farId);

  let direction: GridDirection | undefined;
  let variants: AttachOptions[];
  let current: number;
  if (type.shape === 'bent') {
    direction = grid(out);
    // End b points back into the tube, against the bend; expressed in the start frame.
    const intoB = rotate(qmul(far.orientation, tube.b.orientation), vec(0, 0, 1));
    const bend = grid(scale(rotate(qconj(start.orientation), intoB), -1));
    variants = direction ? bendDirections(direction).map((b) => ({ bend: b })) : [];
    current = variants.findIndex((v) => v.bend === bend);
  } else {
    if (keepFar) return [];
    direction = tube.a.adapterArm ?? grid(out);
    const lean = tube.a.adapterArm && grid(add(scale(out, Math.SQRT2), unit(tube.a.adapterArm)));
    variants = direction ? [{}, ...obliqueDirections(direction).map((o) => ({ oblique: o }))] : [];
    current = variants.findIndex((v) => v.oblique === lean);
  }
  if (!direction || current < 0) return [];

  // A far junction that goes with the old position is no target for the new one.
  const without: ConstructionSnapshot = keepFar
    ? snapshot
    : {
        ...snapshot,
        realization: { ...realization, intentPoses: realization.intentPoses.filter((p) => p.intent.id !== farId) },
      };
  const order = [...variants.slice(current + 1), ...variants.slice(0, current)];
  return order.flatMap((options) => {
    const attached = attachTube(
      without,
      { junctionId: tube.a.junctionId, direction: direction! },
      { familyId: tube.familyId, colour: tube.appearance.colour },
      catalog,
      options,
    );
    const added = attached.operations.find((op) => op.kind === 'add-tube');
    if (added?.kind !== 'add-tube') return [];
    const reused = added.tube.b.junctionId === farId;
    return [
      {
        baseRevision: snapshot.revision,
        operations: [
          ...attached.operations.filter((op) => op.kind === 'add-junction'),
          { kind: 'set-tube', tube: { ...tube, a: added.tube.a, b: added.tube.b } } as const,
          ...(keepFar || reused ? [] : [{ kind: 'remove-intent', target: { kind: 'junction', id: farId } } as const]),
        ],
      },
    ];
  });
}
