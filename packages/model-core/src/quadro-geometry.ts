import type { CollisionGeometryProvider, CollisionShape } from './buildability.js';
import type { ConnectionEvaluator } from './core.js';
import type {
  AccessoryType,
  AttachmentSite,
  ConnectionType,
  PartCatalog,
  PartType,
  PlateType,
  TubeHole,
  TubeType,
} from './catalog.js';
import type { Pose, Quaternion, Vector3 } from './geometry.js';
import type { ConnectorArticle, GridDirection, PlateArticle, TubeArticle, TubeDrilling } from './article-catalog.js';
import { add, qaxisAngle, qmul, scale, vec } from './math.js';
import { quadroArticleCatalog } from './quadro-articles.js';

/**
 * Provisional QUADRO geometry from the 2006 design program (GEOMETRIE.md).
 * Not measured on parts. Tube holes and plate flanges follow the information in
 * GEOMETRIE.md, section 5; the drilling of special tubes is a hypothesis.
 * Part type IDs equal the article catalog IDs.
 */

const ARM_SHOULDER = 25;
const TUBE_RADIUS = 25;
const ROLL_STEPS = [0, 0.5, 1, 1.5].map((f) => f * Math.PI);

const ARM = 'quadro-arm';
const TUBE_END = 'quadro-tube-end';
const TUBE_HOLE = 'quadro-tube-hole';
const PLATE_MOUNT = 'quadro-plate-mount';

/** Hole centre from the tube end face (GEOMETRIE.md, section 5). */
const HOLE_FROM_END = 25;
/** Plate: underside and flange faces 25.12 from the tube axes, flanges down to z = -22, 3 thick. */
const PLATE = { lift: 25.12, flangeDepth: 22, thickness: 3 };

const X = vec(1, 0, 0);
const Y = vec(0, 1, 0);
const IDENTITY: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Site orientation with +Z along the direction. Opposite directions differ by a
 * half turn about local y, so a straight chain arm–tube–arm arrives untwisted.
 */
const Z_TO: Readonly<Record<GridDirection, Quaternion>> = {
  '+x': qaxisAngle(Y, Math.PI / 2),
  '-x': qaxisAngle(Y, -Math.PI / 2),
  '+y': qaxisAngle(X, -Math.PI / 2),
  '-y': qmul(qaxisAngle(X, -Math.PI / 2), qaxisAngle(Y, Math.PI)),
  '+z': IDENTITY,
  '-z': qaxisAngle(Y, Math.PI),
};
const UNIT: Readonly<Record<GridDirection, Vector3>> = {
  '+x': vec(1, 0, 0),
  '-x': vec(-1, 0, 0),
  '+y': vec(0, 1, 0),
  '-y': vec(0, -1, 0),
  '+z': vec(0, 0, 1),
  '-z': vec(0, 0, -1),
};

const site = (id: string, role: AttachmentSite['role'], frame: Pose, interfaceId: string): AttachmentSite => ({
  id,
  role,
  frame,
  interfaceId,
  capacity: 1,
});

function connectorType(article: ConnectorArticle): AccessoryType {
  return {
    kind: 'connector',
    id: article.id,
    familyId: article.familyId,
    name: article.name,
    geometry: { display: { key: article.id }, collision: { key: 'quadro-connector-body' } },
    sites: (article.armDirections ?? []).map((d) =>
      site(d, 'socket', { position: scale(UNIT[d], ARM_SHOULDER), orientation: Z_TO[d] }, ARM),
    ),
  };
}

/** Straight tube: origin at the end a face, +x along the tube. */
function straightTube(article: TubeArticle): TubeType {
  const length = (article.nominalLengthCm ?? 0) * 10;
  const drilled = drilledHoles(article.drilling, length);
  return {
    kind: 'tube',
    id: article.id,
    familyId: article.familyId,
    name: article.name,
    geometry: { display: { key: article.id }, collision: { key: `quadro-tube-${length}` } },
    sites: [
      site('a', 'tube-end', { position: vec(0, 0, 0), orientation: Z_TO['-x'] }, TUBE_END),
      site('b', 'tube-end', { position: vec(length, 0, 0), orientation: Z_TO['+x'] }, TUBE_END),
      ...drilled.sites,
    ],
    shape: 'straight',
    nominalLengthMm: length,
    centerlineLengthMm: length,
    ends: { a: 'a', b: 'b' },
    holes: drilled.holes,
    standardVariant: article.drilling.kind === 'standard',
  };
}

/**
 * Holes per end as angles about the tube axis, measured from local +z (HERSTELLERREGELN.md,
 * section 4, hypothesis): standard one per end on the same side; 180° a through hole;
 * 90° two at right angles; 135° two at end a, one at end b.
 */
function holeAngles(drilling: TubeDrilling): { a: number[]; b: number[] } {
  if (drilling.kind === 'standard') return { a: [0], b: [0] };
  const second = (drilling.designationDeg * Math.PI) / 180;
  return drilling.holes === 3 ? { a: [0, second], b: [0] } : { a: [0, second], b: [0, second] };
}

/** Hole sites on the axis at the hole's station; +Z points radially out through the hole. */
function drilledHoles(drilling: TubeDrilling, length: number): { sites: AttachmentSite[]; holes: TubeHole[] } {
  const sites: AttachmentSite[] = [];
  const holes: TubeHole[] = [];
  const angles = holeAngles(drilling);
  for (const [end, station] of [
    ['a', HOLE_FROM_END],
    ['b', length - HOLE_FROM_END],
  ] as const) {
    for (const angle of angles[end]) {
      const id = `hole-${end}-${Math.round((angle * 180) / Math.PI)}`;
      sites.push(site(id, 'hole', { position: vec(station, 0, 0), orientation: qaxisAngle(X, angle) }, TUBE_HOLE));
      holes.push({ siteId: id, stationMm: station });
    }
  }
  return { sites, holes };
}

/**
 * Plate in its grid cell: origin between the four junctions, z = 0 in the plane of
 * the tube axes, the plate above. Flanges run along x on the tubes at y = ±y/2 and
 * hold two screws each, 50 from the junction centres (GEOMETRIE.md, section 5).
 * Mount sites sit on those tube axes, +Z towards the tube.
 */
function plateType(article: PlateArticle): PlateType | undefined {
  if (!article.tubeGridCm) return undefined;
  const [x, y] = article.tubeGridCm.map((cm) => cm * 10 + 2 * ARM_SHOULDER) as [number, number];
  const reach = x / 2 - ARM_SHOULDER - HOLE_FROM_END;
  const sites: AttachmentSite[] = [];
  for (const sy of [1, -1]) {
    for (const sx of [1, -1]) {
      const id = `mount${sx > 0 ? '+' : '-'}x${sy > 0 ? '+' : '-'}y`;
      const toward = qaxisAngle(X, sy > 0 ? -Math.PI / 2 : Math.PI / 2);
      sites.push(site(id, 'mount', { position: vec(sx * reach, (sy * y) / 2, 0), orientation: toward }, PLATE_MOUNT));
    }
  }
  return {
    kind: 'plate',
    id: article.id,
    familyId: article.familyId,
    name: article.name,
    geometry: { display: { key: article.id }, collision: { key: `quadro-plate-${x}x${y}` } },
    sites,
    cellMm: [x, y],
    requiredMounts: sites.map((s) => s.id),
  };
}

/** Quarter bend: 50 straight, radius 325, 50 straight; end b face at (375, 375). */
const BEND = { straight: 50, radius: 325 };
function curvedTube(article: TubeArticle): TubeType {
  const reach = BEND.straight + BEND.radius;
  return {
    kind: 'tube',
    id: article.id,
    familyId: article.familyId,
    name: article.name,
    geometry: { display: { key: article.id }, collision: { key: 'quadro-curved-tube' } },
    sites: [
      site('a', 'tube-end', { position: vec(0, 0, 0), orientation: Z_TO['-x'] }, TUBE_END),
      site('b', 'tube-end', { position: vec(reach, reach, 0), orientation: Z_TO['+y'] }, TUBE_END),
    ],
    shape: 'bent',
    nominalLengthMm: 0,
    centerlineLengthMm: 2 * BEND.straight + (Math.PI / 2) * BEND.radius,
    ends: { a: 'a', b: 'b' },
    holes: [],
    standardVariant: article.drilling.kind === 'standard',
  };
}

/**
 * Angle connector 45°. Frame: origin at the sleeve's open face on the arm
 * shoulder, +x along the arm. The sleeve takes an arm like a tube end; the
 * spigot is an arm of a virtual connector 36 behind the axis crossing at 108.3
 * from the connector centre (GEOMETRIE.md, section 3).
 */
const ANGLE = { crossing: 108.3, virtual: 36, sleeve: 70 };
const SPIGOT_DIRECTION = vec(-Math.SQRT1_2, Math.SQRT1_2, 0);
const VIRTUAL_CENTRE = add(vec(ANGLE.crossing - ARM_SHOULDER, 0, 0), scale(SPIGOT_DIRECTION, ANGLE.virtual));
const SPIGOT_SHOULDER = add(VIRTUAL_CENTRE, scale(SPIGOT_DIRECTION, ARM_SHOULDER));

function angleConnector(article: ConnectorArticle): AccessoryType {
  // +Z along the spigot: turn +Z onto +x, then 135° about z.
  const spigot = qmul(qaxisAngle(vec(0, 0, 1), (3 * Math.PI) / 4), Z_TO['+x']);
  return {
    kind: 'adapter',
    id: article.id,
    familyId: article.familyId,
    name: article.name,
    geometry: { display: { key: article.id }, collision: { key: 'quadro-angle-connector' } },
    sites: [
      site('sleeve', 'tube-end', { position: vec(0, 0, 0), orientation: Z_TO['-x'] }, TUBE_END),
      site('spigot', 'socket', { position: SPIGOT_SHOULDER, orientation: spigot }, ARM),
    ],
  };
}

function partTypes(): PartType[] {
  const types: PartType[] = [];
  for (const entry of quadroArticleCatalog.entries) {
    if (entry.category === 'connector' && entry.armDirections) types.push(connectorType(entry));
    else if (entry.category === 'connector' && entry.connector === 'angle') types.push(angleConnector(entry));
    else if (entry.category === 'tube' && entry.shape === 'straight') types.push(straightTube(entry));
    else if (entry.category === 'tube' && entry.shape === 'bent') types.push(curvedTube(entry));
    else if (entry.category === 'plate' && (entry.plate === 'solid' || entry.plate === 'perforated')) {
      const plate = plateType(entry);
      if (plate) types.push(plate);
    }
  }
  return types;
}

/** Tube end on an arm: end face on the shoulder, turned in 90° steps (provisional). */
const ARM_TUBE: ConnectionType = {
  id: 'quadro-arm-tube',
  aInterfaceId: ARM,
  bInterfaceId: TUBE_END,
  kinematics: {
    kind: 'parametric',
    evaluatorKey: 'quadro-arm-tube',
    parameters: [{ name: 'rollRad', unit: 'radian', domain: { kind: 'discrete', values: ROLL_STEPS } }],
  },
};

/**
 * Plate screw through a flange into a tube hole: the mount faces the hole and lies
 * along the tube one way or the other.
 */
const TUBE_PLATE: ConnectionType = {
  id: 'quadro-tube-plate',
  aInterfaceId: TUBE_HOLE,
  bInterfaceId: PLATE_MOUNT,
  kinematics: {
    kind: 'parametric',
    evaluatorKey: 'quadro-tube-plate',
    parameters: [{ name: 'turnRad', unit: 'radian', domain: { kind: 'discrete', values: [0, Math.PI] } }],
  },
};

export const quadroPartCatalog: PartCatalog = {
  ref: { id: 'quadro-provisional', version: '2006-1' },
  partTypes: partTypes(),
  connectionTypes: [ARM_TUBE, TUBE_PLATE],
};

/** Site b faces site a (half turn about x), then turns by rollRad about its axis. */
export const quadroConnectionEvaluators: Readonly<Record<string, ConnectionEvaluator>> = {
  'quadro-arm-tube': (parameters) => ({
    position: vec(0, 0, 0),
    orientation: qmul(qaxisAngle(X, Math.PI), qaxisAngle(vec(0, 0, 1), parameters.rollRad ?? 0)),
  }),
  'quadro-tube-plate': (parameters) => ({
    position: vec(0, 0, 0),
    orientation: qmul(qaxisAngle(X, Math.PI), qaxisAngle(vec(0, 0, 1), parameters.turnRad ?? 0)),
  }),
};

function arcCapsules(): CollisionShape[] {
  const shapes: CollisionShape[] = [];
  const centre = vec(BEND.straight, BEND.radius, 0);
  const point = (angle: number) => add(centre, vec(BEND.radius * Math.sin(angle), -BEND.radius * Math.cos(angle), 0));
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * (Math.PI / 2);
    const a1 = ((i + 1) / steps) * (Math.PI / 2);
    shapes.push({ kind: 'capsule', a: point(a0), b: point(a1), radiusMm: TUBE_RADIUS });
  }
  const reach = BEND.straight + BEND.radius;
  shapes.push({ kind: 'capsule', a: vec(TUBE_RADIUS, 0, 0), b: vec(BEND.straight, 0, 0), radiusMm: TUBE_RADIUS });
  shapes.push({
    kind: 'capsule',
    a: vec(reach, BEND.radius, 0),
    b: vec(reach, reach - TUBE_RADIUS, 0),
    radiusMm: TUBE_RADIUS,
  });
  return shapes;
}

/** Polygonal cylinder: 12 points per end on the circle of the given radius. */
function cylinderPoints(a: Vector3, b: Vector3, radius: number): Vector3[] {
  const axis = vec(b.x - a.x, b.y - a.y, b.z - a.z);
  const len = Math.hypot(axis.x, axis.y, axis.z);
  const u = vec(0, 0, 1);
  const w = vec(axis.y * u.z - axis.z * u.y, axis.z * u.x - axis.x * u.z, axis.x * u.y - axis.y * u.x);
  const wl = Math.hypot(w.x, w.y, w.z) || 1;
  const n1 = scale(w, 1 / wl);
  const n2 = scale(
    vec(axis.y * n1.z - axis.z * n1.y, axis.z * n1.x - axis.x * n1.z, axis.x * n1.y - axis.y * n1.x),
    1 / len,
  );
  const points: Vector3[] = [];
  for (let i = 0; i < 12; i++) {
    const angle = (i * Math.PI) / 6;
    const offset = add(scale(n1, Math.cos(angle) * radius), scale(n2, Math.sin(angle) * radius));
    points.push(add(a, offset), add(b, offset));
  }
  return points;
}

/** Outer hulls only: inserted arms and spigots are not part of the collision shape. */
export const quadroCollisionGeometry: CollisionGeometryProvider = {
  shapes(ref) {
    if (ref.key === 'quadro-connector-body') {
      return [{ kind: 'box', center: vec(0, 0, 0), halfExtents: vec(ARM_SHOULDER, ARM_SHOULDER, ARM_SHOULDER) }];
    }
    if (ref.key === 'quadro-curved-tube') return arcCapsules();
    if (ref.key === 'quadro-angle-connector') {
      // Body: cylinder Ø 50 along the spigot axis from the sleeve end (x = 70) to
      // the shoulder. Only 42 long, so a capsule would reach into the tube.
      const crossing = vec(ANGLE.crossing - ARM_SHOULDER, 0, 0);
      const from = add(
        crossing,
        scale(SPIGOT_DIRECTION, (ANGLE.crossing - ARM_SHOULDER - ANGLE.sleeve) / Math.SQRT1_2),
      );
      return [
        { kind: 'capsule', a: vec(TUBE_RADIUS, 0, 0), b: vec(ANGLE.sleeve - TUBE_RADIUS, 0, 0), radiusMm: TUBE_RADIUS },
        { kind: 'convex', points: cylinderPoints(from, SPIGOT_SHOULDER, TUBE_RADIUS) },
      ];
    }
    const plate = /^quadro-plate-(\d+)x(\d+)$/.exec(ref.key);
    if (plate) {
      const [x, y] = [Number(plate[1]), Number(plate[2])];
      const { lift, flangeDepth, thickness } = PLATE;
      // Flanges end a plate thickness short of the crossing tubes, so an outward wall
      // plate clears a floor plate lying inside on the same tube (platform).
      const flange = (side: number): CollisionShape => ({
        kind: 'box',
        center: vec(0, side * (y / 2 - lift - thickness / 2), (lift - flangeDepth) / 2),
        halfExtents: vec(x / 2 - lift - thickness, thickness / 2, (lift + flangeDepth) / 2),
      });
      // Corners are cut out around the junctions, so upright tubes fit (GEOMETRIE.md,
      // section 5); two crossing boxes cover the rest.
      const z = lift + thickness / 2;
      return [
        { kind: 'box', center: vec(0, 0, z), halfExtents: vec(x / 2 - lift, y / 2, thickness / 2) },
        { kind: 'box', center: vec(0, 0, z), halfExtents: vec(x / 2, y / 2 - lift, thickness / 2) },
        flange(1),
        flange(-1),
      ];
    }
    const tube = /^quadro-tube-(\d+)$/.exec(ref.key);
    if (tube) {
      const length = Number(tube[1]);
      return [
        { kind: 'capsule', a: vec(TUBE_RADIUS, 0, 0), b: vec(length - TUBE_RADIUS, 0, 0), radiusMm: TUBE_RADIUS },
      ];
    }
    return undefined;
  },
};
