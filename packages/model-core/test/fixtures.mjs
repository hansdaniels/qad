// Synthetic test catalog and a square frame in a 400 mm grid (BAUBARKEIT.md, section 7).
import { compose, inverse, qaxisAngle, qmul, vec } from '../src/math.ts';

const deg = Math.PI / 180;
export const rot = (axis, degrees) => qaxisAngle(axis, degrees * deg);
const X = vec(1, 0, 0);
const Y = vec(0, 1, 0);
const IDENTITY_Q = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Rotation mapping local +Z onto the given axis direction. Opposite sockets differ
 * by a half turn about local y, so that a straight chain socket–tube–socket
 * arrives without twist.
 */
const zTo = {
  '+x': rot(Y, 90),
  '-x': rot(Y, -90),
  '+y': rot(X, -90),
  '-y': qmul(rot(X, -90), rot(Y, 180)),
  '+z': IDENTITY_Q,
  '-z': rot(Y, 180),
};
const unit = {
  '+x': vec(1, 0, 0),
  '-x': vec(-1, 0, 0),
  '+y': vec(0, 1, 0),
  '-y': vec(0, -1, 0),
  '+z': vec(0, 0, 1),
  '-z': vec(0, 0, -1),
};

const pose = (position, orientation = IDENTITY_Q) => ({ position, orientation });
const scaled = (v, s) => vec(v.x * s, v.y * s, v.z * s);

function tubeType(lengthMm) {
  return {
    kind: 'tube',
    id: `tube-${lengthMm}`,
    familyId: `tube-${lengthMm}`,
    name: `Rohr ${lengthMm}`,
    geometry: { display: { key: `tube-${lengthMm}` }, collision: { key: `tube-${lengthMm}` } },
    sites: [
      { id: 'a', role: 'tube-end', frame: pose(vec(0, 0, 0), zTo['-x']), interfaceId: 'tube-end', capacity: 1 },
      { id: 'b', role: 'tube-end', frame: pose(vec(lengthMm, 0, 0), zTo['+x']), interfaceId: 'tube-end', capacity: 1 },
    ],
    shape: 'straight',
    nominalLengthMm: lengthMm,
    centerlineLengthMm: lengthMm,
    ends: { a: 'a', b: 'b' },
    holes: [],
    standardVariant: true,
  };
}

const flip = pose(vec(0, 0, 0), rot(X, 180));

export function catalog() {
  return {
    ref: { id: 'synthetic', version: '1' },
    partTypes: [
      {
        kind: 'connector',
        id: 'hub',
        familyId: 'hub',
        name: 'Kupplung 6-armig',
        geometry: { display: { key: 'hub' }, collision: { key: 'hub' } },
        sites: Object.keys(zTo).map((d) => ({
          id: d,
          role: 'socket',
          frame: pose(scaled(unit[d], 25), zTo[d]),
          interfaceId: 'socket',
          capacity: 1,
        })),
      },
      tubeType(300),
      tubeType(350),
      tubeType(400),
    ],
    connectionTypes: [
      // Tube end face against the arm shoulder; the end frame faces the connector.
      { id: 'push', aInterfaceId: 'socket', bInterfaceId: 'tube-end', kinematics: { kind: 'fixed', bInA: flip } },
      { id: 'pull', aInterfaceId: 'tube-end', bInterfaceId: 'socket', kinematics: { kind: 'fixed', bInA: flip } },
    ],
  };
}

export const options = {
  tolerance: { distanceMm: 1, angleRad: 1 * deg },
  minClearanceMm: 0,
  maxRemediesPerFinding: 3,
};

const corners = [vec(0, 0, 0), vec(400, 0, 0), vec(400, 400, 0), vec(0, 400, 0)];
const sides = [
  ['+x', '-x'],
  ['+y', '-y'],
  ['-x', '+x'],
  ['-y', '+y'],
];

/**
 * Square frame h1..h4 with tubes t1..t4. lengths[i] selects tube i's type;
 * reversed[i] connects the b end of tube i with a 'pull' connection.
 */
export function square({ lengths = [350, 350, 350, 350], reversed = [] } = {}) {
  const parts = [];
  const connections = [];
  const tubes = [];
  for (let i = 0; i < 4; i++) {
    parts.push({
      id: `h${i + 1}`,
      typeId: 'hub',
      origin: { intent: { kind: 'junction', id: `j${i + 1}` }, role: 'connector' },
    });
  }
  for (let i = 0; i < 4; i++) {
    const [out, into] = sides[i];
    const from = `h${i + 1}`;
    const to = `h${((i + 1) % 4) + 1}`;
    parts.push({
      id: `t${i + 1}`,
      typeId: `tube-${lengths[i]}`,
      origin: { intent: { kind: 'tube', id: `t${i + 1}` }, role: 'body' },
    });
    connections.push({
      id: `c${i + 1}a`,
      a: { partId: from, siteId: out },
      b: { partId: `t${i + 1}`, siteId: 'a' },
      typeId: 'push',
      parameters: {},
    });
    connections.push(
      reversed[i]
        ? {
            id: `c${i + 1}b`,
            a: { partId: `t${i + 1}`, siteId: 'b' },
            b: { partId: to, siteId: into },
            typeId: 'pull',
            parameters: {},
          }
        : {
            id: `c${i + 1}b`,
            a: { partId: to, siteId: into },
            b: { partId: `t${i + 1}`, siteId: 'b' },
            typeId: 'push',
            parameters: {},
          },
    );
    const endFrame = (d) => ({ orientation: zTo[d], roll: { mode: 'free' } });
    tubes.push({
      id: `t${i + 1}`,
      familyId: `tube-${lengths[i]}`,
      a: { junctionId: `j${i + 1}`, ...endFrame(out) },
      b: { junctionId: `j${((i + 1) % 4) + 1}`, ...endFrame(into) },
      variant: { mode: 'automatic' },
      appearance: { colour: 'red' },
    });
  }
  const snapshot = {
    revision: 0,
    design: {
      id: 'square',
      catalog: { id: 'synthetic', version: '1' },
      tubes,
      junctions: corners.map((_, i) => ({ id: `j${i + 1}` })),
      plates: [],
      slides: [],
      anchors: [{ id: 'anchor', target: { kind: 'junction', id: 'j1' }, worldPose: pose(corners[0]) }],
    },
    realization: {
      parts,
      connections,
      plateMounts: [],
      poses: [],
      intentPoses: corners.map((c, i) => ({ intent: { kind: 'junction', id: `j${i + 1}` }, worldPose: pose(c) })),
    },
  };
  return withPoses(snapshot, catalog());
}

/** Stores poses as a solver would: breadth-first from h1 in connection ID order. */
export function withPoses(snapshot, cat) {
  const types = new Map(cat.partTypes.map((t) => [t.id, t]));
  const site = (ref) => {
    const p = snapshot.realization.parts.find((x) => x.id === ref.partId);
    return types.get(p.typeId).sites.find((s) => s.id === ref.siteId).frame;
  };
  const poses = new Map([['h1', snapshot.design.anchors[0].worldPose]]);
  const queue = ['h1'];
  const sorted = [...snapshot.realization.connections].sort((a, b) => (a.id < b.id ? -1 : 1));
  while (queue.length) {
    const current = queue.shift();
    for (const c of sorted) {
      const relative = cat.connectionTypes.find((t) => t.id === c.typeId).kinematics.bInA;
      if (c.a.partId === current && !poses.has(c.b.partId)) {
        poses.set(c.b.partId, compose(compose(compose(poses.get(current), site(c.a)), relative), inverse(site(c.b))));
        queue.push(c.b.partId);
      } else if (c.b.partId === current && !poses.has(c.a.partId)) {
        poses.set(
          c.a.partId,
          compose(compose(compose(poses.get(current), site(c.b)), inverse(relative)), inverse(site(c.a))),
        );
        queue.push(c.a.partId);
      }
    }
  }
  return {
    ...snapshot,
    realization: { ...snapshot.realization, poses: [...poses].map(([partId, worldPose]) => ({ partId, worldPose })) },
  };
}

/** Hub: box ±25. Tube: capsule whose hull spans exactly 0..length along x. */
export function geometryProvider(extra = {}) {
  return {
    shapes(ref) {
      if (ref.key in extra) return extra[ref.key];
      if (ref.key === 'hub') return [{ kind: 'box', center: vec(0, 0, 0), halfExtents: vec(25, 25, 25) }];
      const tube = /^tube-(\d+)$/.exec(ref.key);
      if (tube) {
        const lengthMm = Number(tube[1]);
        return [{ kind: 'capsule', a: vec(25, 0, 0), b: vec(lengthMm - 25, 0, 0), radiusMm: 25 }];
      }
      return undefined;
    },
  };
}

export const geometry = geometryProvider();

/** Adds a separately anchored tube with the given world pose. */
export function withLooseTube(snapshot, id, worldPose, lengthMm = 350) {
  const tube = {
    id,
    familyId: `tube-${lengthMm}`,
    a: { junctionId: `${id}-a`, orientation: zTo['+x'], roll: { mode: 'free' } },
    b: { junctionId: `${id}-b`, orientation: zTo['-x'], roll: { mode: 'free' } },
    variant: { mode: 'automatic' },
    appearance: { colour: 'red' },
  };
  return {
    ...snapshot,
    design: {
      ...snapshot.design,
      tubes: [...snapshot.design.tubes, tube],
      junctions: [...snapshot.design.junctions, { id: `${id}-a` }, { id: `${id}-b` }],
      anchors: [...snapshot.design.anchors, { id: `anchor-${id}`, target: { kind: 'tube', id }, worldPose }],
    },
    realization: {
      ...snapshot.realization,
      parts: [
        ...snapshot.realization.parts,
        { id, typeId: `tube-${lengthMm}`, origin: { intent: { kind: 'tube', id }, role: 'body' } },
      ],
      poses: [...snapshot.realization.poses, { partId: id, worldPose }],
    },
  };
}
export { qmul };
