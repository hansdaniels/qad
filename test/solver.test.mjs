import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_TOLERANCE, checkBuildability, findOpenEnds, quadroCollisionGeometry, quadroConnectionEvaluators,
  quadroPartCatalog, solveRealization,
} from '../dist/index.js';
import { qaxisAngle, qmul as qmulLocal, vec } from '../dist/math.js';

const options = { tolerance: DEFAULT_TOLERANCE, connectionEvaluators: quadroConnectionEvaluators };
const checkOptions = { ...options, minClearanceMm: 0, maxRemediesPerFinding: 3 };
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const origin = { position: vec(0, 0, 0), orientation: IDENTITY };

/** Rotation taking +Z onto an axis direction such as '+x'. */
const toward = {
  '+x': qaxisAngle(vec(0, 1, 0), Math.PI / 2), '-x': qaxisAngle(vec(0, 1, 0), -Math.PI / 2),
  '+y': qaxisAngle(vec(1, 0, 0), -Math.PI / 2), '-y': qaxisAngle(vec(1, 0, 0), Math.PI / 2),
  '+z': IDENTITY, '-z': qaxisAngle(vec(1, 0, 0), Math.PI),
};
const opposite = { '+x': '-x', '-x': '+x', '+y': '-y', '-y': '+y', '+z': '-z', '-z': '+z' };

/** tubes: [id, family, fromJunction, toJunction, direction at from]. */
function design(tubes, { anchor = { id: 'anchor', target: { kind: 'junction', id: 'j1' }, worldPose: origin }, variant } = {}) {
  const junctions = [...new Set(tubes.flatMap(([, , a, b]) => [a, b]))].sort();
  return {
    id: 'd', catalog: quadroPartCatalog.ref, plates: [], anchors: [anchor],
    junctions: junctions.map((id) => ({ id })),
    tubes: tubes.map(([id, familyId, a, b, d]) => ({
      id, familyId,
      a: { junctionId: a, orientation: toward[d], roll: { mode: 'free' } },
      b: { junctionId: b, orientation: toward[opposite[d]], roll: { mode: 'free' } },
      variant: variant?.[id] ?? { mode: 'automatic' }, appearance: { colour: 'red' },
    })),
  };
}

const SQUARE = [
  ['t1', 'tube-35cm', 'j1', 'j2', '+x'], ['t2', 'tube-35cm', 'j2', 'j3', '+y'],
  ['t3', 'tube-35cm', 'j3', 'j4', '-x'], ['t4', 'tube-35cm', 'j4', 'j1', '-y'],
];

function solveAndCheck(d, previous) {
  const solved = solveRealization(d, quadroPartCatalog, options, previous);
  assert.equal(solved.ok, true, JSON.stringify(solved.diagnostics));
  const report = checkBuildability({ revision: 0, design: d, realization: solved.value }, quadroPartCatalog, quadroCollisionGeometry, checkOptions);
  assert.equal(report.verdict, 'buildable', JSON.stringify(report.findings.map((f) => f.diagnostic)));
  return solved.value;
}

const near = (actual, expected) => assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y, actual.z - expected.z) < 1e-6,
  `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
const typeOf = (realization, intentId) => realization.parts.find((p) => p.origin.intent.id === intentId && ['connector', 'body'].includes(p.origin.role))?.typeId;
const poseOf = (realization, intentId) => realization.intentPoses.find((p) => p.intent.id === intentId)?.worldPose.position;

test('a square drawn from tubes alone gets elbow connectors and closes in the 400 grid', () => {
  const r = solveAndCheck(design(SQUARE));
  for (const j of ['j1', 'j2', 'j3', 'j4']) assert.equal(typeOf(r, j), 'elbow-connector', j);
  near(poseOf(r, 'j3'), vec(400, 400, 0));
  assert.equal(r.parts.length, 8);
  assert.equal(r.connections.length, 8);
});

test('solving again keeps part IDs and choices', () => {
  const d = design(SQUARE);
  const first = solveAndCheck(d);
  const second = solveAndCheck(d, first);
  assert.deepEqual(second, first);
});

test('a further tube changes the connector but keeps its identity and the attached tubes', () => {
  const first = solveAndCheck(design(SQUARE));
  const extended = solveAndCheck(design([...SQUARE, ['t5', 'tube-35cm', 'j1', 'j5', '+z']]), first);
  const connector = (r) => r.parts.find((p) => p.origin.intent.id === 'j1');
  assert.equal(connector(extended).id, connector(first).id);
  assert.equal(connector(extended).typeId, '3way-connector');
  for (const t of ['t1', 't2', 't3', 't4']) {
    assert.equal(extended.parts.find((p) => p.origin.intent.id === t).id, first.parts.find((p) => p.origin.intent.id === t).id);
  }
  near(poseOf(extended, 'j5'), vec(0, 0, 400));
});

test('a single tube has open ends at virtual junction points one arm length away', () => {
  const d = design([['t1', 'tube-75cm', 'j1', 'j2', '+x']]);
  const r = solveAndCheck(d);
  assert.equal(r.parts.length, 1);
  near(poseOf(r, 'j2'), vec(800, 0, 0));
  assert.equal(findOpenEnds(d).length, 2);
});

test('mixed lengths in a ring that cannot close are a conflict', () => {
  const ring = [...SQUARE.slice(0, 3), ['t4', 'tube-25cm', 'j4', 'j1', '-y']];
  const solved = solveRealization(design(ring), quadroPartCatalog, options);
  assert.equal(solved.ok, false);
  assert.equal(solved.diagnostics[0].code, 'loop-closure-conflict');
  assert.ok(Math.abs(solved.diagnostics[0].details.offsetMm - 100) < 1e-6);
});

test('a tube that is neither axis-parallel nor on a 45° diagonal is explained', () => {
  const d = design(SQUARE);
  d.tubes[0] = { ...d.tubes[0], a: { ...d.tubes[0].a, orientation: qaxisAngle(vec(0, 1, 0), Math.PI / 6) } };
  const solved = solveRealization(d, quadroPartCatalog, options);
  assert.equal(solved.ok, false);
  assert.equal(solved.diagnostics[0].code, 'junction-angle-unsupported');
});

test('a fixed drilling variant is realised; a foreign one is a conflict', () => {
  const fixed = solveAndCheck(design(SQUARE, { variant: { t1: { mode: 'fixed', typeId: 'tube-35cm-90deg-4hole' } } }));
  assert.equal(typeOf(fixed, 't1'), 'tube-35cm-90deg-4hole');
  const foreign = solveRealization(design(SQUARE, { variant: { t1: { mode: 'fixed', typeId: 'tube-25cm' } } }), quadroPartCatalog, options);
  assert.equal(foreign.diagnostics[0].code, 'fixed-variant-conflict');
});

test('an anchor on a tube places the assembly from that tube', () => {
  const anchor = { id: 'anchor', target: { kind: 'tube', id: 't1' }, worldPose: { position: vec(25, 0, 0), orientation: IDENTITY } };
  const r = solveAndCheck(design(SQUARE, { anchor }));
  const j1 = poseOf(r, 'j1');
  assert.ok(Math.hypot(j1.x, j1.y, j1.z) < 1e-9, JSON.stringify(j1));
});

test('a curved tube joins two connectors two grid steps apart', () => {
  const d = design([['t1', 'tube-35cm', 'j1', 'j2', '+y'], ['t2', 'tube-35cm', 'j2', 'j3', '+x']]);
  d.tubes.push({
    id: 'bend', familyId: 'curved-tube',
    a: { junctionId: 'j1', orientation: toward['+x'], roll: { mode: 'free' } },
    b: { junctionId: 'j3', orientation: toward['-y'], roll: { mode: 'free' } },
    variant: { mode: 'automatic' }, appearance: { colour: 'red' },
  });
  const r = solveAndCheck(d);
  near(poseOf(r, 'j3'), vec(400, 400, 0));
  assert.equal(typeOf(r, 'bend'), 'curved-tube');
});

test('plates are not realised yet', () => {
  const d = design(SQUARE);
  d.plates = [{ id: 'p', familyId: 'panel', variant: { mode: 'automatic' }, appearance: { colour: 'blue' },
    placement: { junctionId: 'j1', pose: origin }, mounts: [] }];
  assert.equal(solveRealization(d, quadroPartCatalog, options).diagnostics[0].code, 'no-realization');
});

test('an oblique tube gets an angle connector on a free arm of the auto connector', () => {
  const c = Math.SQRT1_2;
  const d = design([['t1', 'tube-35cm', 'j1', 'j2', '+x']]);
  // Up-left at 45° in the xy plane: reachable from the -y arm (the +x arm is taken).
  const oblique = { x: -c, y: c, z: 0 };
  const turn = qaxisAngle(vec(1, 0, 0), -Math.PI / 2);          // +Z onto +y
  const tilt = qaxisAngle(vec(0, 0, 1), Math.PI / 4);           // +y onto (-c, c)
  const into = qmulLocal(tilt, turn);
  d.tubes.push({
    id: 't2', familyId: 'tube-35cm',
    a: { junctionId: 'j1', orientation: into, roll: { mode: 'free' } },
    b: { junctionId: 'j3', orientation: qmulLocal(qaxisAngle(vec(0, 0, 1), Math.PI), into), roll: { mode: 'free' } },
    variant: { mode: 'automatic' }, appearance: { colour: 'red' },
  });
  d.junctions.push({ id: 'j3' });
  const r = solveAndCheck(d);
  const adapter = r.parts.find((p) => p.typeId === 'diagonal-connector');
  assert.ok(adapter, JSON.stringify(r.parts.map((p) => p.typeId)));
  assert.deepEqual(adapter.origin, { intent: { kind: 'junction', id: 'j1' }, role: 'angle-adapter:t2:a' });
  assert.equal(typeOf(r, 'j1'), 'elbow-connector');
  // Virtual centre 36 behind the axis crossing at 108.3 on the -y arm, then 400 along the tube.
  const v = vec(-36 * c, -108.3 + 36 * c, 0);
  near(poseOf(r, 'j3'), vec(v.x + 400 * oblique.x, v.y + 400 * oblique.y, 0));
  assert.deepEqual(solveAndCheck(d, r), r);
});

test('an angle no adapter reaches stays a conflict', () => {
  const d = design([['t1', 'tube-35cm', 'j1', 'j2', '+x']]);
  d.tubes.push({
    id: 't2', familyId: 'tube-35cm',
    a: { junctionId: 'j1', orientation: qaxisAngle(vec(1, 0, 0), -Math.PI / 6), roll: { mode: 'free' } },
    b: { junctionId: 'j3', orientation: qaxisAngle(vec(1, 0, 0), Math.PI - Math.PI / 6), roll: { mode: 'free' } },
    variant: { mode: 'automatic' }, appearance: { colour: 'red' },
  });
  d.junctions.push({ id: 'j3' });
  const solved = solveRealization(d, quadroPartCatalog, options);
  assert.equal(solved.diagnostics[0].code, 'junction-angle-unsupported');
});
