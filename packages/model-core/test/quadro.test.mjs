import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  DEFAULT_TOLERANCE,
  checkBuildability,
  quadroCollisionGeometry,
  quadroConnectionEvaluators,
  quadroDisplayGeometry,
  quadroPartCatalog,
} from '../src/index.ts';
import { compose, inverse, qangle, qaxisAngle, qconj, qmul, vec } from '../src/math.ts';

const options = {
  tolerance: DEFAULT_TOLERANCE,
  minClearanceMm: 0,
  maxRemediesPerFinding: 3,
  connectionEvaluators: quadroConnectionEvaluators,
};
const types = new Map(quadroPartCatalog.partTypes.map((t) => [t.id, t]));
const turn = (degrees) => qaxisAngle(vec(0, 0, 1), (degrees * Math.PI) / 180);
const pose = (x, y, z, orientation = turn(0)) => ({ position: vec(x, y, z), orientation });
const ROLLS = [0, 0.5, 1, 1.5].map((f) => f * Math.PI);

/** Rotation taking +Z onto the given unit direction (any roll). */
function zOnto(d) {
  const z = vec(0, 0, 1);
  const c = d.z;
  if (c > 1 - 1e-12) return { x: 0, y: 0, z: 0, w: 1 };
  if (c < -1 + 1e-12) return qaxisAngle(vec(1, 0, 0), Math.PI);
  const axis = vec(z.y * d.z - z.z * d.y, z.z * d.x - z.x * d.z, z.x * d.y - z.y * d.x);
  return qaxisAngle(axis, Math.acos(c));
}

/**
 * Builds a snapshot from explicit part poses. links: [partA, armSite, partB, tubeEndSite].
 * Each link takes the 90° roll that fits the given poses. junctionOf maps parts to
 * junctions; tubes list their end junctions.
 */
function model({ parts, links, junctions, tubes, anchor }) {
  const site = (partId, siteId) => types.get(parts[partId].type).sites.find((s) => s.id === siteId);
  const connections = links.map(([a, as, b, bs], i) => {
    const sa = compose(parts[a].pose, site(a, as).frame);
    const sb = compose(parts[b].pose, site(b, bs).frame);
    const actual = compose(inverse(sa), sb);
    const best = ROLLS.map((rollRad) => ({
      rollRad,
      angle: qangle(
        qmul(qconj(quadroConnectionEvaluators['quadro-arm-tube']({ rollRad }).orientation), actual.orientation),
      ),
    })).sort((x, y) => x.angle - y.angle)[0];
    return {
      id: `c${String(i).padStart(2, '0')}`,
      a: { partId: a, siteId: as },
      b: { partId: b, siteId: bs },
      typeId: 'quadro-arm-tube',
      parameters: { rollRad: best.rollRad },
    };
  });
  const designTubes = Object.entries(tubes).map(([id, ends]) => {
    const type = types.get(parts[id].type);
    const endpoint = (end) => {
      const s = type.sites.find((x) => x.id === type.ends[end]);
      const frame = compose(parts[id].pose, s.frame);
      // Site +Z points out of the tube; the design's end frame points into it.
      const out = compose(frame, pose(0, 0, 1)).position;
      const direction = vec(frame.position.x - out.x, frame.position.y - out.y, frame.position.z - out.z);
      return { junctionId: ends[end], orientation: zOnto(direction), roll: { mode: 'free' } };
    };
    return {
      id,
      familyId: type.familyId,
      a: endpoint('a'),
      b: endpoint('b'),
      variant: { mode: 'automatic' },
      appearance: { colour: 'red' },
    };
  });
  return {
    revision: 0,
    design: {
      id: 'quadro',
      catalog: quadroPartCatalog.ref,
      tubes: designTubes,
      junctions: Object.keys(junctions).map((id) => ({ id })),
      plates: [],
      slides: [],
      anchors: [{ id: 'anchor', target: { kind: 'junction', id: anchor }, worldPose: junctions[anchor] }],
    },
    realization: {
      parts: Object.entries(parts).map(([id, p]) => ({
        id,
        typeId: p.type,
        origin: { intent: p.intent, role: p.role },
      })),
      connections,
      plateMounts: [],
      poses: Object.entries(parts).map(([id, p]) => ({ partId: id, worldPose: p.pose })),
      intentPoses: Object.entries(junctions).map(([id, worldPose]) => ({
        intent: { kind: 'junction', id },
        worldPose,
      })),
    },
  };
}

const connector = (type, junction, p) => ({
  type,
  pose: p,
  intent: { kind: 'junction', id: junction },
  role: 'connector',
});
const tube = (type, id, p) => ({ type, pose: p, intent: { kind: 'tube', id }, role: 'body' });
const check = (snapshot) => checkBuildability(snapshot, quadroPartCatalog, quadroCollisionGeometry, options);
const codes = (report) => report.findings.map((f) => f.diagnostic.code);

/** Square of 35 cm tubes with elbow connectors; tube t4 may be swapped. */
function square(lastTube = 'tube-35cm', lastLength = 350) {
  const corner = (i) =>
    [pose(0, 0, 0), pose(400, 0, 0, turn(90)), pose(400, 400, 0, turn(180)), pose(0, 400, 0, turn(270))][i];
  return model({
    anchor: 'j1',
    junctions: { j1: pose(0, 0, 0), j2: pose(400, 0, 0), j3: pose(400, 400, 0), j4: pose(0, 400, 0) },
    parts: {
      h1: connector('elbow-connector', 'j1', corner(0)),
      h2: connector('elbow-connector', 'j2', corner(1)),
      h3: connector('elbow-connector', 'j3', corner(2)),
      h4: connector('elbow-connector', 'j4', corner(3)),
      t1: tube('tube-35cm', 't1', pose(25, 0, 0)),
      t2: tube('tube-35cm', 't2', pose(400, 25, 0, turn(90))),
      t3: tube('tube-35cm', 't3', pose(375, 400, 0, turn(180))),
      t4: tube(lastTube, 't4', pose(0, 400 - 25 - (350 - lastLength), 0, turn(270))),
    },
    links: [
      ['h1', '+x', 't1', 'a'],
      ['h2', '+y', 't1', 'b'],
      ['h2', '+x', 't2', 'a'],
      ['h3', '+y', 't2', 'b'],
      ['h3', '+x', 't3', 'a'],
      ['h4', '+y', 't3', 'b'],
      ['h4', '+x', 't4', 'a'],
      ['h1', '+y', 't4', 'b'],
    ],
    tubes: { t1: { a: 'j1', b: 'j2' }, t2: { a: 'j2', b: 'j3' }, t3: { a: 'j3', b: 'j4' }, t4: { a: 'j4', b: 'j1' } },
  });
}

test('the provisional catalog covers grid connectors, tubes, the curved tube and the angle connector', () => {
  for (const id of [
    '3way-connector',
    '6way-connector',
    'elbow-connector',
    'tube-10cm',
    'tube-75cm',
    'tube-35cm-90deg-4hole',
    'curved-tube',
    'diagonal-connector',
  ]) {
    assert.ok(types.has(id), id);
  }
  assert.equal(types.get('6way-connector').sites.length, 6);
  assert.equal(types.get('tube-52cm').nominalLengthMm, 520);
});

test('a 35 cm square with elbow connectors closes in the 400 mm grid', () => {
  const report = check(square());
  assert.equal(report.verdict, 'buildable', JSON.stringify(report.findings.map((f) => f.diagnostic)));
  assert.equal(report.stats.cycles, 1);
});

test('a 25 cm tube in the 35 cm square leaves a 100 mm gap where the ring is closed', () => {
  // Closing the ring with the last tube's connection to h1 (c07).
  const report = checkBuildability(square('tube-25cm', 250), quadroPartCatalog, quadroCollisionGeometry, options, {
    addedConnectionIds: ['c07'],
  });
  const residual = report.findings.find((f) => f.closure)?.closure;
  assert.equal(residual?.connectionId, 'c07', codes(report).join());
  assert.ok(Math.abs(residual.axialMm - 100) < 1e-6, String(residual.axialMm));
});

test('a curved tube closes a ring like a frame corner of two grid steps', () => {
  const snapshot = model({
    anchor: 'j1',
    junctions: { j1: pose(0, 0, 0), j3: pose(400, 400, 0), j4: pose(0, 400, 0) },
    parts: {
      h1: connector('elbow-connector', 'j1', pose(0, 0, 0)),
      h4: connector('elbow-connector', 'j4', pose(0, 400, 0, turn(-90))),
      h3: connector('elbow-connector', 'j3', pose(400, 400, 0, turn(180))),
      up: tube('tube-35cm', 'up', pose(0, 25, 0, turn(90))),
      across: tube('tube-35cm', 'across', pose(25, 400, 0)),
      bend: tube('curved-tube', 'bend', pose(25, 0, 0)),
    },
    links: [
      // h4 is turned by -90°: its local +x arm points down (-y), its +y arm along +x.
      ['h1', '+y', 'up', 'a'],
      ['h4', '+x', 'up', 'b'],
      ['h4', '+y', 'across', 'a'],
      ['h3', '+x', 'across', 'b'],
      ['h1', '+x', 'bend', 'a'],
      ['h3', '+y', 'bend', 'b'],
    ],
    tubes: { up: { a: 'j1', b: 'j4' }, across: { a: 'j4', b: 'j3' }, bend: { a: 'j1', b: 'j3' } },
  });
  const report = check(snapshot);
  assert.equal(report.verdict, 'buildable', JSON.stringify(report.findings.map((f) => f.diagnostic)));
  assert.equal(report.stats.cycles, 1);
});

test('an angle connector carries an oblique tube at 45° back over the connector', () => {
  const s = Math.SQRT1_2;
  // Spigot shoulder: virtual centre (82.84, 25.46) plus 25 along (-s, s), in connector coordinates.
  const shoulder = vec(108.3 - 36 * s - 25 * s, 36 * s + 25 * s, 0);
  const snapshot = model({
    anchor: 'j1',
    junctions: { j1: pose(0, 0, 0), j2: pose(shoulder.x - 375 * s, shoulder.y + 375 * s, 0) },
    parts: {
      h1: connector('cross-connector', 'j1', pose(0, 0, 0)),
      w1: {
        type: 'diagonal-connector',
        pose: pose(25, 0, 0),
        intent: { kind: 'junction', id: 'j1' },
        role: 'angle-adapter-1',
      },
      t1: tube('tube-35cm', 't1', pose(shoulder.x, shoulder.y, 0, turn(135))),
    },
    links: [
      ['h1', '+x', 'w1', 'sleeve'],
      ['w1', 'spigot', 't1', 'a'],
    ],
    tubes: { t1: { a: 'j1', b: 'j2' } },
  });
  const report = check(snapshot);
  assert.equal(report.verdict, 'buildable', JSON.stringify(report.findings.map((f) => f.diagnostic)));
  assert.ok(report.stats.collisionPairsTested >= 2);
});

test('a tube pushed through a connector collides', () => {
  const base = square();
  const parts = [
    ...base.realization.parts,
    { id: 'x', typeId: 'tube-35cm', origin: { intent: { kind: 'tube', id: 'x' }, role: 'body' } },
  ];
  const stray = pose(-175, 0, 0);
  const snapshot = {
    ...base,
    design: {
      ...base.design,
      tubes: [
        ...base.design.tubes,
        {
          ...base.design.tubes[0],
          id: 'x',
          a: { ...base.design.tubes[0].a, junctionId: 'xa' },
          b: { ...base.design.tubes[0].b, junctionId: 'xb' },
        },
      ],
      junctions: [...base.design.junctions, { id: 'xa' }, { id: 'xb' }],
      anchors: [...base.design.anchors, { id: 'ax', target: { kind: 'tube', id: 'x' }, worldPose: stray }],
    },
    realization: { ...base.realization, parts, poses: [...base.realization.poses, { partId: 'x', worldPose: stray }] },
  };
  assert.ok(codes(check(snapshot)).includes('collision'));
});

test('tubes look hollow, connectors flush with them and bulging outwards, bent tubes as a ring piece between two hollow ends', () => {
  const [tube] = quadroDisplayGeometry.shapes({ key: 'tube-35cm' });
  assert.equal(tube.kind, 'pipe');
  assert.equal(tube.b.x - tube.a.x, 350);
  assert.ok(tube.innerRadiusMm > 0 && tube.innerRadiusMm < tube.radiusMm);
  // One convex body: tube-thick rims at the arm shoulders around a ball, so a
  // straight connector is a cylinder through, never wider than the tubes.
  const [straight] = quadroDisplayGeometry.shapes({ key: 'straight-connector' });
  assert.equal(straight.kind, 'convex');
  const type = quadroPartCatalog.partTypes.find((t) => t.id === 'straight-connector');
  const axis = type.sites[0].frame.position;
  for (const p of straight.points) {
    const along = (p.x * axis.x + p.y * axis.y + p.z * axis.z) / 25;
    const across = Math.sqrt(Math.max(0, p.x ** 2 + p.y ** 2 + p.z ** 2 - along ** 2));
    assert.ok(Math.abs(along) <= 25 + 1e-9 && across <= 25 + 1e-9);
  }
  const bent = quadroDisplayGeometry.shapes({ key: 'curved-tube-135deg-3hole' });
  assert.deepEqual(
    bent.map((s) => s.kind),
    ['pipe', 'arc', 'pipe'],
  );
  // Plate shapes stay as before; unknown keys have none of their own.
  assert.equal(quadroDisplayGeometry.shapes({ key: 'no-such-part' }), undefined);
});

test('exploded views show each connector arm and the angle connector spigot as inserted shapes', () => {
  for (const type of quadroPartCatalog.partTypes.filter((t) => t.kind === 'connector' || t.kind === 'adapter')) {
    const arms = quadroDisplayGeometry.inserted(type.geometry.display);
    assert.equal(arms.length, type.sites.filter((s) => s.role === 'socket').length, type.id);
    for (const arm of arms) {
      assert.equal(arm.kind, 'pipe');
      assert.ok(Math.abs(Math.hypot(arm.b.x - arm.a.x, arm.b.y - arm.a.y, arm.b.z - arm.a.z) - 50) < 1e-9);
    }
  }
  assert.equal(
    quadroDisplayGeometry.inserted(quadroPartCatalog.partTypes.find((t) => t.id === 'tube-35cm').geometry.display),
    undefined,
  );
});
