import type { GridDirection } from './article-catalog.js';
import type { PartCatalog } from './catalog.js';
import type { EditCommand } from './commands.js';
import type { ConstructionSnapshot } from './core.js';
import type { ColourId, FamilyId, JunctionId } from './ids.js';
import type { Pose, Quaternion, Vector3 } from './geometry.js';
import { AXIS_ROTATIONS, compose, dot, length, qconj, qmul, rotate, vec } from './math.js';

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

/**
 * Free directions at every junction that carries tubes. Occupied are the axes of
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
    if (!frame || ends.length === 0) continue;
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

/** Command that attaches a straight tube at a free direction, ending in a new junction. */
export function attachTube(
  snapshot: ConstructionSnapshot,
  at: { readonly junctionId: JunctionId; readonly direction: GridDirection },
  tube: { readonly familyId: FamilyId; readonly colour: ColourId },
): EditCommand {
  const { design } = snapshot;
  const junctionId = nextId(
    'j',
    design.junctions.map((j) => j.id),
  );
  const tubeId = nextId(
    't',
    design.tubes.map((t) => t.id),
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
          a: { junctionId: at.junctionId, orientation: towardDirection(at.direction), roll: { mode: 'free' } },
          b: { junctionId, orientation: towardDirection(opposite(at.direction)), roll: { mode: 'free' } },
          variant: { mode: 'automatic' },
          appearance: { colour: tube.colour },
        },
      },
    ],
  };
}
