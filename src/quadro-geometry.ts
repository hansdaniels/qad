import type { CollisionGeometryProvider, CollisionShape, ConnectionEvaluator } from './buildability.js';
import type { AccessoryType, AttachmentSite, ConnectionType, PartCatalog, PartType, TubeType } from './catalog.js';
import type { Pose, Quaternion, Vector3 } from './geometry.js';
import type { ConnectorArticle, GridDirection, TubeArticle } from './article-catalog.js';
import { add, qaxisAngle, qmul, scale, vec } from './math.js';
import { quadroArticleCatalog } from './quadro-articles.js';

/**
 * Provisional QUADRO geometry from the 2006 design program (GEOMETRIE.md).
 * Not measured on parts; drilling patterns are unknown, so tubes have no holes.
 * Part type IDs equal the article catalog IDs.
 */

const ARM_SHOULDER = 25;
const TUBE_RADIUS = 25;
const ROLL_STEPS = [0, 0.5, 1, 1.5].map((f) => f * Math.PI);

const ARM = 'quadro-arm';
const TUBE_END = 'quadro-tube-end';

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
  '+x': vec(1, 0, 0), '-x': vec(-1, 0, 0), '+y': vec(0, 1, 0), '-y': vec(0, -1, 0), '+z': vec(0, 0, 1), '-z': vec(0, 0, -1),
};

const site = (id: string, role: AttachmentSite['role'], frame: Pose, interfaceId: string): AttachmentSite =>
  ({ id, role, frame, interfaceId, capacity: 1 });

function connectorType(article: ConnectorArticle): AccessoryType {
  return {
    kind: 'connector', id: article.id, familyId: article.familyId, name: article.name,
    geometry: { display: { key: article.id }, collision: { key: 'quadro-connector-body' } },
    sites: (article.armDirections ?? []).map((d) =>
      site(d, 'socket', { position: scale(UNIT[d], ARM_SHOULDER), orientation: Z_TO[d] }, ARM)),
  };
}

/** Straight tube: origin at the end a face, +x along the tube. */
function straightTube(article: TubeArticle): TubeType {
  const length = (article.nominalLengthCm ?? 0) * 10;
  return {
    kind: 'tube', id: article.id, familyId: article.familyId, name: article.name,
    geometry: { display: { key: article.id }, collision: { key: `quadro-tube-${length}` } },
    sites: [
      site('a', 'tube-end', { position: vec(0, 0, 0), orientation: Z_TO['-x'] }, TUBE_END),
      site('b', 'tube-end', { position: vec(length, 0, 0), orientation: Z_TO['+x'] }, TUBE_END),
    ],
    shape: 'straight', nominalLengthMm: length, centerlineLengthMm: length,
    ends: { a: 'a', b: 'b' }, holes: [], standardVariant: article.drilling.kind === 'standard',
  };
}

/** Quarter bend: 50 straight, radius 325, 50 straight; end b face at (375, 375). */
const BEND = { straight: 50, radius: 325 };
function curvedTube(article: TubeArticle): TubeType {
  const reach = BEND.straight + BEND.radius;
  return {
    kind: 'tube', id: article.id, familyId: article.familyId, name: article.name,
    geometry: { display: { key: article.id }, collision: { key: 'quadro-curved-tube' } },
    sites: [
      site('a', 'tube-end', { position: vec(0, 0, 0), orientation: Z_TO['-x'] }, TUBE_END),
      site('b', 'tube-end', { position: vec(reach, reach, 0), orientation: Z_TO['+y'] }, TUBE_END),
    ],
    shape: 'bent', nominalLengthMm: 0,
    centerlineLengthMm: 2 * BEND.straight + (Math.PI / 2) * BEND.radius,
    ends: { a: 'a', b: 'b' }, holes: [], standardVariant: article.drilling.kind === 'standard',
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
    kind: 'adapter', id: article.id, familyId: article.familyId, name: article.name,
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

export const quadroPartCatalog: PartCatalog = {
  ref: { id: 'quadro-provisional', version: '2006-1' },
  partTypes: partTypes(),
  connectionTypes: [ARM_TUBE],
};

/** Site b faces site a (half turn about x), then turns by rollRad about its axis. */
export const quadroConnectionEvaluators: Readonly<Record<string, ConnectionEvaluator>> = {
  'quadro-arm-tube': (parameters) => ({
    position: vec(0, 0, 0),
    orientation: qmul(qaxisAngle(X, Math.PI), qaxisAngle(vec(0, 0, 1), parameters.rollRad ?? 0)),
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
  shapes.push({ kind: 'capsule', a: vec(reach, BEND.radius, 0), b: vec(reach, reach - TUBE_RADIUS, 0), radiusMm: TUBE_RADIUS });
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
  const n2 = scale(vec(axis.y * n1.z - axis.z * n1.y, axis.z * n1.x - axis.x * n1.z, axis.x * n1.y - axis.y * n1.x), 1 / len);
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
      const from = add(crossing, scale(SPIGOT_DIRECTION, (ANGLE.crossing - ARM_SHOULDER - ANGLE.sleeve) / Math.SQRT1_2));
      return [
        { kind: 'capsule', a: vec(TUBE_RADIUS, 0, 0), b: vec(ANGLE.sleeve - TUBE_RADIUS, 0, 0), radiusMm: TUBE_RADIUS },
        { kind: 'convex', points: cylinderPoints(from, SPIGOT_SHOULDER, TUBE_RADIUS) },
      ];
    }
    const tube = /^quadro-tube-(\d+)$/.exec(ref.key);
    if (tube) {
      const length = Number(tube[1]);
      return [{ kind: 'capsule', a: vec(TUBE_RADIUS, 0, 0), b: vec(length - TUBE_RADIUS, 0, 0), radiusMm: TUBE_RADIUS }];
    }
    return undefined;
  },
};

