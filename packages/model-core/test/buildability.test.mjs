import assert from 'node:assert/strict';
import test from 'node:test';
import { checkBuildability } from '../dist/buildability-checker.js';
import { catalog, geometry, options, qmul, rot, square, withPoses } from './fixtures.mjs';

const check = (snapshot, edit, cat = catalog(), opts = options) => checkBuildability(snapshot, cat, geometry, opts, edit);
const codes = (report) => report.findings.map((f) => f.diagnostic.code);
const closure = (report) => report.findings.find((f) => f.diagnostic.code === 'loop-closure-conflict')?.closure;

test('a square frame closes exactly and is buildable', () => {
  const report = check(square());
  assert.deepEqual(codes(report), []);
  assert.equal(report.verdict, 'buildable');
  assert.equal(report.stats.cycles, 1);
});

test('the frame built tube by tube is buildable at every step', () => {
  const full = square();
  const order = ['c1a', 'c1b', 'c2a', 'c2b', 'c3a', 'c3b', 'c4a', 'c4b'];
  for (let n = 2; n <= order.length; n += 2) {
    const ids = new Set(order.slice(0, n));
    const used = new Set(['h1', ...full.realization.connections.filter((c) => ids.has(c.id)).flatMap((c) => [c.a.partId, c.b.partId])]);
    const step = {
      ...full,
      realization: {
        ...full.realization,
        parts: full.realization.parts.filter((p) => used.has(p.id)),
        connections: full.realization.connections.filter((c) => ids.has(c.id)),
        poses: full.realization.poses.filter((p) => used.has(p.partId)),
      },
    };
    step.design = { ...full.design, tubes: full.design.tubes.filter((t) => used.has(t.id)) };
    const report = check(step, { addedConnectionIds: order.slice(n - 2, n) });
    assert.equal(report.verdict, 'buildable', `after ${order[n - 1]}: ${codes(report)}`);
  }
});

for (const reversed of [false, true]) {
  const side = reversed ? 'tube end as side a' : 'tube end as side b';
  test(`a tube one step too short leaves a 50 mm gap (${side})`, () => {
    const snapshot = withPoses(square({ lengths: [350, 350, 350, 300], reversed: [false, false, false, reversed] }), catalog());
    const report = check(snapshot, { addedConnectionIds: ['c4b'] });
    assert.equal(report.verdict, 'not-buildable');
    const residual = closure(report);
    assert.equal(residual.connectionId, 'c4b');
    assert.ok(Math.abs(residual.axialMm - 50) < 1e-6, String(residual.axialMm));
    assert.ok(residual.lateralMm < 1e-6 && residual.tiltRad < 1e-6 && residual.twistRad < 1e-6);
  });

  test(`a tube one step too long overlaps by 50 mm (${side})`, () => {
    const snapshot = withPoses(square({ lengths: [350, 350, 350, 400], reversed: [false, false, false, reversed] }), catalog());
    const residual = closure(check(snapshot, { addedConnectionIds: ['c4b'] }));
    assert.ok(Math.abs(residual.axialMm + 50) < 1e-6, String(residual.axialMm));
  });
}

test('the ring lists all parts of the cycle and marks the closing connection', () => {
  const snapshot = withPoses(square({ lengths: [350, 350, 350, 300] }), catalog());
  const finding = check(snapshot, { addedConnectionIds: ['c4b'] }).findings.find((f) => f.diagnostic.code === 'loop-closure-conflict');
  assert.deepEqual([...finding.closure.cycle].sort(), ['h1', 'h2', 'h3', 'h4', 't1', 't2', 't3', 't4']);
  assert.deepEqual(finding.diagnostic.subjects[0], { kind: 'connection', id: 'c4b' });
});

test('a new closing edge is reported even if a plain search would make it a tree edge', () => {
  const base = square({ lengths: [350, 350, 350, 300] });
  const renamed = (c) => (c.id === 'c4b' ? { ...c, id: 'c0' } : c);
  const snapshot = { ...base, realization: { ...base.realization, connections: base.realization.connections.map(renamed) } };
  assert.equal(closure(check(snapshot, { addedConnectionIds: ['c0'] })).connectionId, 'c0');
  assert.notEqual(closure(check(snapshot)).connectionId, 'c0');
});

test('an incremental check matches a full check with the same added connections', () => {
  const snapshot = withPoses(square({ lengths: [350, 350, 350, 300] }), catalog());
  const incremental = check(snapshot, { addedConnectionIds: ['c4b'], affectedParts: ['t4', 'h1'] });
  const full = check(snapshot, { addedConnectionIds: ['c4b'] });
  assert.deepEqual(incremental.findings, full.findings);
});

test('a hand-moved tube pose is rejected as a data error without repair', () => {
  const snapshot = square();
  const poses = snapshot.realization.poses.map((p) => (p.partId === 't2'
    ? { ...p, worldPose: { ...p.worldPose, position: { ...p.worldPose.position, z: 30 } } } : p));
  const report = check({ ...snapshot, realization: { ...snapshot.realization, poses } });
  assert.equal(report.verdict, 'not-buildable');
  const finding = report.findings.find((f) => f.diagnostic.code === 'invalid-data');
  assert.deepEqual(finding.diagnostic.subjects, [{ kind: 'part', id: 't2' }]);
  assert.ok(Math.abs(snapshot.realization.poses.find((p) => p.partId === 't2').worldPose.position.z) < 1e-9);
});

test('a deleted connection splits the frame into an unanchored assembly', () => {
  const snapshot = square();
  const connections = snapshot.realization.connections.filter((c) => c.id !== 'c2a' && c.id !== 'c3b');
  const report = check({ ...snapshot, realization: { ...snapshot.realization, connections } });
  assert.ok(codes(report).includes('unresolved-placement'));
});

test('structure errors name the offending objects', () => {
  const base = square();
  const variants = [
    ['catalog-mismatch', (s) => ({ ...s, design: { ...s.design, catalog: { id: 'synthetic', version: '2' } } })],
    ['missing-reference', (s) => ({ ...s, realization: { ...s.realization, parts: s.realization.parts.map((p) => (p.id === 't1' ? { ...p, typeId: 'nope' } : p)) } })],
    ['incompatible-attachment', (s) => ({ ...s, realization: { ...s.realization, connections: s.realization.connections.map((c) => (c.id === 'c1a' ? { ...c, typeId: 'pull' } : c)) } })],
    ['attachment-occupied', (s) => ({ ...s, realization: { ...s.realization, connections: [...s.realization.connections, { id: 'c9', a: { partId: 'h1', siteId: '+x' }, b: { partId: 't3', siteId: 'a' }, typeId: 'push', parameters: {} }] } })],
    ['duplicate-member', (s) => ({ ...s, realization: { ...s.realization, connections: [...s.realization.connections, { ...s.realization.connections[0], id: 'c9' }] } })],
    ['duplicate-id', (s) => ({ ...s, realization: { ...s.realization, parts: [...s.realization.parts, s.realization.parts[0]] } })],
    ['invalid-data', (s) => ({ ...s, design: { ...s.design, anchors: [{ ...s.design.anchors[0], worldPose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 2 } } }] } })],
  ];
  for (const [code, corrupt] of variants) {
    const report = check(corrupt(base));
    assert.equal(report.verdict, 'not-buildable', code);
    assert.ok(codes(report).includes(code), `${code}: ${codes(report)}`);
    assert.ok(report.findings.every((f) => f.stage === 'structure' || f.diagnostic.code !== 'loop-closure-conflict'), code);
  }
});

test('a tube direction contradicting the design is a misfit', () => {
  const snapshot = square();
  const tubes = snapshot.design.tubes.map((t) => (t.id === 't1'
    ? { ...t, a: { ...t.a, orientation: { x: 0, y: 0, z: 0, w: 1 } } } : t)); // +z: connectable, but not realised
  const report = check({ ...snapshot, design: { ...snapshot.design, tubes } });
  assert.deepEqual(codes(report), ['connection-misfit']);
});

test('a fixed roll is compared in full, a free roll only by direction', () => {
  const snapshot = square();
  const fixed = (radians) => snapshot.design.tubes.map((t) => (t.id === 't1' ? { ...t, a: { ...t.a, roll: { mode: 'fixed', radians } } } : t));
  const wrong = check({ ...snapshot, design: { ...snapshot.design, tubes: fixed(Math.PI / 2) } });
  assert.deepEqual(codes(wrong), ['connection-misfit']);
});

test('a connector off its junction point is a misfit', () => {
  const snapshot = square();
  const intentPoses = snapshot.realization.intentPoses.map((p) => (p.intent.id === 'j3'
    ? { ...p, worldPose: { ...p.worldPose, position: { x: 400, y: 410, z: 0 } } } : p));
  const report = check({ ...snapshot, realization: { ...snapshot.realization, intentPoses } });
  assert.deepEqual(codes(report), ['connection-misfit']);
});

test('a fixed variant that is not realised is a conflict', () => {
  const snapshot = square();
  const tubes = snapshot.design.tubes.map((t) => (t.id === 't1' ? { ...t, variant: { mode: 'fixed', typeId: 'tube-400' } } : t));
  assert.ok(codes(check({ ...snapshot, design: { ...snapshot.design, tubes } })).includes('fixed-variant-conflict'));
});

test('a parametric connection without evaluator leaves the verdict undetermined', () => {
  const cat = catalog();
  cat.connectionTypes = cat.connectionTypes.map((t) => (t.id === 'push'
    ? { ...t, kinematics: { kind: 'parametric', evaluatorKey: 'hinge', parameters: [] } } : t));
  const report = check(square(), undefined, cat);
  assert.equal(report.verdict, 'undetermined');
  assert.deepEqual(report.missingCatalogData, [{ key: 'evaluator:hinge' }]);
});

test('a proven error outranks missing catalog data', () => {
  const cat = catalog();
  cat.connectionTypes = [...cat.connectionTypes, { id: 'spin', aInterfaceId: 'x', bInterfaceId: 'y', kinematics: { kind: 'parametric', evaluatorKey: 'spin', parameters: [] } }];
  const snapshot = withPoses(square({ lengths: [350, 350, 350, 300] }), cat);
  const parts = [...snapshot.realization.parts, { id: 'z', typeId: 'hub', origin: { intent: { kind: 'junction', id: 'j1' }, role: 'extra' } }];
  const report = check({ ...snapshot, realization: { ...snapshot.realization, parts } }, { addedConnectionIds: ['c4b'] }, cat);
  assert.equal(report.verdict, 'not-buildable');
});

test('residuals of a rotated rule are reported in site a axes with correct signs', async () => {
  const { compose, inverse, qaxisAngle, qconj, qmul, rotate, vec } = await import('../dist/math.js');
  const tiltedA = { position: vec(10, 20, 5), orientation: qmul(qaxisAngle(vec(1, 1, 0), 0.7), qaxisAngle(vec(0, 0, 1), 0.3)) };
  const rule = { position: vec(3, -2, 1), orientation: qmul(qaxisAngle(vec(1, 0, 0), Math.PI / 2), qaxisAngle(vec(0, 1, 0), 0.4)) };
  const q = rule.orientation;
  const blockA = { position: vec(0, 0, 0), orientation: { x: 0, y: 0, z: 0, w: 1 } };
  const make = (actualOffset) => {
    // c1 places B; c2 closes. B's site s2 is placed so that actual = expected · offset.
    const expected = compose(tiltedA, rule);
    const bPose = { position: vec(100, 0, 0), orientation: { x: 0, y: 0, z: 0, w: 1 } };
    const s2 = compose(inverse(bPose), compose(expected, actualOffset));
    const types = [
      { kind: 'accessory', id: 'A', familyId: 'A', name: 'A', geometry: { display: { key: 'A' }, collision: { key: 'A' } },
        sites: [{ id: 's1', role: 'mount', frame: blockA, interfaceId: 'p', capacity: 1 },
          { id: 's2', role: 'mount', frame: tiltedA, interfaceId: 'p', capacity: 1 }] },
      { kind: 'accessory', id: 'B', familyId: 'B', name: 'B', geometry: { display: { key: 'B' }, collision: { key: 'B' } },
        sites: [{ id: 's1', role: 'mount', frame: { position: vec(-100, 0, 0), orientation: blockA.orientation }, interfaceId: 'q', capacity: 1 },
          { id: 's2', role: 'mount', frame: s2, interfaceId: 'q', capacity: 1 }] },
    ];
    const cat = {
      ref: { id: 'synthetic', version: '1' }, partTypes: types,
      connectionTypes: [
        { id: 'plain', aInterfaceId: 'p', bInterfaceId: 'q', kinematics: { kind: 'fixed', bInA: blockA } },
        { id: 'rotated', aInterfaceId: 'p', bInterfaceId: 'q', kinematics: { kind: 'fixed', bInA: rule } },
      ],
    };
    const snapshot = {
      revision: 0,
      design: { id: 'd', catalog: cat.ref, tubes: [], junctions: [{ id: 'j' }], plates: [],
        anchors: [{ id: 'anchor', target: { kind: 'junction', id: 'j' }, worldPose: blockA }] },
      realization: {
        parts: [{ id: 'A', typeId: 'A', origin: { intent: { kind: 'junction', id: 'j' }, role: 'block' } },
          { id: 'B', typeId: 'B', origin: { intent: { kind: 'junction', id: 'j' }, role: 'other' } }],
        connections: [{ id: 'c1', a: { partId: 'A', siteId: 's1' }, b: { partId: 'B', siteId: 's1' }, typeId: 'plain', parameters: {} },
          { id: 'c2', a: { partId: 'A', siteId: 's2' }, b: { partId: 'B', siteId: 's2' }, typeId: 'rotated', parameters: {} }],
        plateMounts: [], poses: [{ partId: 'A', worldPose: blockA }, { partId: 'B', worldPose: bPose }], intentPoses: [],
      },
    };
    return checkBuildability(snapshot, cat, geometry, options, { addedConnectionIds: ['c2'] });
  };
  const translateInA = (d) => ({ position: rotate(qconj(q), d), orientation: { x: 0, y: 0, z: 0, w: 1 } });
  const rotateInA = (axis, angle) => ({ position: vec(0, 0, 0), orientation: qmul(qmul(qconj(q), qaxisAngle(axis, angle)), q) });

  const gap = closure(make(translateInA(vec(0, 0, 5))));
  assert.ok(Math.abs(gap.axialMm - 5) < 1e-9 && gap.lateralMm < 1e-9, JSON.stringify(gap));
  const overlap = closure(make(translateInA(vec(0, 0, -4))));
  assert.ok(Math.abs(overlap.axialMm + 4) < 1e-9, JSON.stringify(overlap));
  const sideways = closure(make(translateInA(vec(3, 4, 0))));
  assert.ok(Math.abs(sideways.lateralMm - 5) < 1e-9 && Math.abs(sideways.axialMm) < 1e-9, JSON.stringify(sideways));
  const tilt = closure(make(rotateInA(vec(1, 0, 0), 0.05)));
  assert.ok(Math.abs(tilt.tiltRad - 0.05) < 1e-9 && tilt.twistRad < 1e-9, JSON.stringify(tilt));
  const twist = closure(make(rotateInA(vec(0, 0, 1), 0.05)));
  assert.ok(Math.abs(twist.twistRad - 0.05) < 1e-9 && twist.tiltRad < 1e-9, JSON.stringify(twist));
});

function withExtraTubes(snapshot, directions) {
  const tubes = directions.map((d, i) => ({
    id: `x${i}`, familyId: 'tube-350',
    a: { junctionId: 'j1', orientation: d, roll: { mode: 'free' } },
    b: { junctionId: `jx${i}`, orientation: d, roll: { mode: 'free' } },
    variant: { mode: 'automatic' }, appearance: { colour: 'red' },
  }));
  return {
    ...snapshot,
    design: {
      ...snapshot.design,
      tubes: [...snapshot.design.tubes, ...tubes],
      junctions: [...snapshot.design.junctions, ...tubes.map((t) => ({ id: t.b.junctionId }))],
    },
  };
}

test('a tube direction no connector offers is explained with its deviation', () => {
  // Desired direction 30° from +x in the xy plane: turn +Z onto +x, then 30° about z.
  const direction = qmul(rot({ x: 0, y: 0, z: 1 }, 30), rot({ x: 0, y: 1, z: 0 }, 90));
  const report = check(withExtraTubes(square(), [direction]));
  const finding = report.findings.find((f) => f.diagnostic.code === 'junction-angle-unsupported');
  assert.ok(finding, codes(report).join());
  assert.equal(finding.stage, 'junction-angles');
  assert.equal(finding.diagnostic.details.closestConnector, 'hub');
  assert.ok(finding.diagnostic.details['deviationDeg:x0'] > 1);
  assert.deepEqual(finding.diagnostic.subjects[0], { kind: 'intent', ref: { kind: 'junction', id: 'j1' } });
});

test('more tubes than any connector has sockets cannot be joined', () => {
  const up = { x: 0, y: 0, z: 0, w: 1 };
  const report = check(withExtraTubes(square(), [up, up, up, up, up]));
  assert.ok(codes(report).includes('junction-angle-unsupported'));
});

test('the frame has no collisions and the broad phase tests neighbouring pairs', async () => {
  const report = check(square());
  assert.equal(report.verdict, 'buildable');
  assert.ok(report.stats.collisionPairsTested >= 8, String(report.stats.collisionPairsTested));
});

test('two tubes crossing without a junction are reported with stations', async () => {
  const { withLooseTube } = await import('./fixtures.mjs');
  // Along y through x = 200, crossing t1 (from x = 25) at its station 175.
  const loose = withLooseTube(square(), 'y1', { position: { x: 200, y: -175, z: 0 }, orientation: rot({ x: 0, y: 0, z: 1 }, 90) });
  const report = check(loose);
  const finding = report.findings.find((f) => f.diagnostic.code === 'crossing');
  assert.ok(finding, codes(report).join());
  assert.deepEqual(finding.diagnostic.subjects, [{ kind: 'part', id: 't1' }, { kind: 'part', id: 'y1' }]);
  assert.ok(Math.abs(finding.diagnostic.details.stationAMm - 175) < 1e-6);
  assert.ok(Math.abs(finding.diagnostic.details.stationBMm - 175) < 1e-6);
});

test('a parallel tube 5 mm too close collides with its penetration depth', async () => {
  const { withLooseTube } = await import('./fixtures.mjs');
  const at = (z) => withLooseTube(square(), 'p1', { position: { x: 25, y: 0, z }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  const finding = check(at(45)).findings.find((f) => f.diagnostic.code === 'collision');
  assert.ok(finding);
  assert.ok(Math.abs(finding.diagnostic.details.depthMm - 5) < 0.05, String(finding.diagnostic.details.depthMm));
  assert.equal(check(at(51)).verdict, 'buildable');
  const clearance = check(at(56), undefined, catalog(), { ...options, minClearanceMm: 10 });
  assert.equal(clearance.verdict, 'buildable');
  assert.deepEqual(codes(clearance), ['clearance']);
});

test('a tube moved into another assembly collides; a free move stays valid', async () => {
  const { withLooseTube } = await import('./fixtures.mjs');
  const inside = withLooseTube(square(), 'm1', { position: { x: 380, y: 100, z: 0 }, orientation: rot({ x: 0, y: 0, z: 1 }, 90) });
  assert.ok(codes(check(inside)).includes('collision'));
  const outside = withLooseTube(square(), 'm1', { position: { x: 600, y: 100, z: 0 }, orientation: rot({ x: 0, y: 0, z: 1 }, 90) });
  assert.equal(check(outside).verdict, 'buildable');
});

test('overlap inside the allowed volume of a connection is no collision; beyond it is', async () => {
  const { geometryProvider } = await import('./fixtures.mjs');
  const { vec } = await import('../dist/math.js');
  const cat = catalog();
  cat.connectionTypes = cat.connectionTypes.map((t) => ({ ...t, allowedOverlap: { key: 'socket-overlap' } }));
  // In site a axes (z out of the hub): the hub interior down to 45 mm behind the shoulder.
  const allowed = [{ kind: 'box', center: vec(0, 0, -22.5), halfExtents: vec(30, 30, 22.5) }];
  const reaching = (into) => geometryProvider({
    'socket-overlap': allowed,
    'tube-350': [{ kind: 'capsule', a: vec(25 - into, 0, 0), b: vec(325 + into, 0, 0), radiusMm: 25 }],
  });
  // A straight piece h1–t1–h2: at frame corners, perpendicular tubes would meet inside the hub.
  const full = square();
  const keep = new Set(['h1', 't1', 'h2']);
  const straight = {
    ...full,
    design: { ...full.design, tubes: full.design.tubes.filter((t) => t.id === 't1') },
    realization: {
      ...full.realization,
      parts: full.realization.parts.filter((p) => keep.has(p.id)),
      connections: full.realization.connections.filter((c) => c.id === 'c1a' || c.id === 'c1b'),
      poses: full.realization.poses.filter((p) => keep.has(p.partId)),
    },
  };
  const inside = checkBuildability(straight, cat, reaching(20), options);
  assert.equal(inside.verdict, 'buildable', codes(inside).join());
  // 60 mm in: the hull passes the hub centre and leaves the allowed volume at 45 mm.
  const beyond = checkBuildability(straight, cat, reaching(60), options);
  assert.ok(codes(beyond).includes('collision'), codes(beyond).join());
});

test('missing collision geometry leaves the verdict undetermined', async () => {
  const { geometryProvider } = await import('./fixtures.mjs');
  const report = checkBuildability(square(), catalog(), geometryProvider({ hub: undefined }), options);
  assert.equal(report.verdict, 'undetermined');
  assert.deepEqual(report.missingCatalogData, [{ key: 'hub' }]);
  const broken = checkBuildability(withPoses(square({ lengths: [350, 350, 350, 300] }), catalog()), catalog(),
    geometryProvider({ hub: undefined }), options, { addedConnectionIds: ['c4b'] });
  assert.equal(broken.verdict, 'not-buildable');
});

test('a design with plates stays undetermined until plate mounts are checked', async () => {
  const { checkBuildability: exported, PLATE_MOUNTS_PENDING } = await import('../dist/index.js');
  const snapshot = square();
  const plate = {
    id: 'p1', familyId: 'panel', variant: { mode: 'automatic' }, appearance: { colour: 'blue' },
    placement: { junctionId: 'j1', pose: { position: { x: 200, y: 200, z: 25 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } },
    mounts: [],
  };
  const report = exported({ ...snapshot, design: { ...snapshot.design, plates: [plate] } }, catalog(), geometry, options);
  assert.equal(report.verdict, 'undetermined');
  assert.deepEqual(report.missingCatalogData, [PLATE_MOUNTS_PENDING]);
});
