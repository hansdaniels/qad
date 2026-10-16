import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  DEFAULT_TOLERANCE,
  attachTube,
  billOfMaterials,
  checkBuildability,
  encodeConstruction,
  openConstruction,
  removeTube,
  createModelCore,
  insertPlate,
  plateSpots,
  quadroArticleCatalog,
  quadroCollisionGeometry,
  quadroConnectionEvaluators,
  quadroPartCatalog,
} from '../src/index.ts';
import { rotate, vec } from '../src/math.ts';

const options = {
  tolerance: DEFAULT_TOLERANCE,
  connectionEvaluators: quadroConnectionEvaluators,
  geometry: quadroCollisionGeometry,
};

function build(steps) {
  const created = createModelCore(
    {
      id: 'm',
      catalog: quadroPartCatalog.ref,
      tubes: [],
      junctions: [{ id: 'j1' }],
      plates: [],
      anchors: [
        {
          id: 'anchor',
          target: { kind: 'junction', id: 'j1' },
          worldPose: { position: vec(0, 0, 0), orientation: { x: 0, y: 0, z: 0, w: 1 } },
        },
      ],
    },
    quadroPartCatalog,
    options,
  );
  const core = created.value;
  for (const [junctionId, direction] of steps) {
    const command = attachTube(
      core.snapshot,
      { junctionId, direction },
      { familyId: 'tube-35cm', colour: 'red' },
      quadroPartCatalog,
    );
    const result = core.execute(command);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  }
  return core;
}

const square = [
  ['j1', '+x'],
  ['j2', '+y'],
  ['j3', '-x'],
  ['j4', '-y'],
];

const execute = (core, command) => {
  const result = core.execute(command);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.value;
};

const PLATE = 'panel-40-40cm';
const spotsOf = (core) => plateSpots(core.snapshot, quadroPartCatalog).filter((s) => s.typeId === PLATE);
const byText = (a, b) => a.localeCompare(b);
const top = (s) => s.cellKey.endsWith('00+');

test('a square of 35 cm tubes offers a 40 × 40 plate on both sides in both flange directions', () => {
  const spots = spotsOf(build(square));
  assert.equal(spots.length, 4);
  assert.equal(new Set(spots.map((s) => s.cellKey)).size, 2);
  for (const spot of spots) {
    assert.deepEqual(
      spot.mounts.map((m) => m.stationMm).sort((a, b) => a - b),
      [25, 25, 325, 325],
    );
  }
});

test('a plate on top of the square is buildable and turns its tubes so the holes face it', () => {
  const core = build(square);
  const spot = spotsOf(core).find((s) => top(s) && s.flangeTubes.includes('t1'));
  const s = execute(core, insertPlate(core.snapshot, spot, 'green'));
  assert.equal(s.realization.parts.find((p) => p.origin.intent.kind === 'plate').typeId, PLATE);
  assert.deepEqual([...new Set(s.realization.plateMounts.map((m) => m.tubeId))].sort(byText), ['t1', 't3']);
  // Standard tubes suffice for a single plate.
  assert.ok(s.realization.parts.filter((p) => p.origin.intent.kind === 'tube').every((p) => p.typeId === 'tube-35cm'));
  const report = checkBuildability(s, quadroPartCatalog, quadroCollisionGeometry, {
    tolerance: DEFAULT_TOLERANCE,
    minClearanceMm: 0,
    maxRemediesPerFinding: 3,
    connectionEvaluators: quadroConnectionEvaluators,
  });
  assert.equal(report.verdict, 'buildable', JSON.stringify(report.findings.map((f) => f.diagnostic.message)));
});

test('plates on both sides of a cell cannot share the holes of the same flange tubes', () => {
  const core = build(square);
  execute(
    core,
    insertPlate(
      core.snapshot,
      spotsOf(core).find((s) => top(s) && s.flangeTubes.includes('t1')),
      'blue',
    ),
  );
  const bottom = spotsOf(core).find((s) => !top(s) && s.flangeTubes.includes('t1'));
  const result = core.execute(insertPlate(core.snapshot, bottom, 'blue'));
  // Both flanges sit inside the cell and need the same hole at each tube end.
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics.map((d) => d.code),
    ['plate-mount-conflict'],
  );
});

test('two plates side by side on one shared flange tube take a tube with a through hole', () => {
  const core = build([...square, ['j2', '+x'], ['j5', '+y'], ['j6', '-x']]);
  const shared = core.snapshot.design.tubes.find(
    (t) => [t.a.junctionId, t.b.junctionId].sort(byText).join() === 'j2,j3',
  ).id;
  const both = spotsOf(core).filter((s) => top(s) && s.flangeTubes.includes(shared));
  assert.equal(both.length, 2);
  execute(core, insertPlate(core.snapshot, both[0], 'blue'));
  const s = execute(core, insertPlate(core.snapshot, both[1], 'blue'));
  const body = s.realization.parts.find((p) => p.origin.intent.kind === 'tube' && p.origin.intent.id === shared);
  assert.equal(body.typeId, 'tube-35cm-180deg-4hole');
});

test('plate screws replace the tube screws at the plate ends', () => {
  const core = build(square);
  const s = execute(core, insertPlate(core.snapshot, spotsOf(core).find(top), 'yellow'));
  const lines = billOfMaterials(s, quadroArticleCatalog, quadroPartCatalog).map((l) => [l.name, l.colour, l.quantity]);
  assert.deepEqual(lines, [
    ['Rohr 35 cm', 'red', 4],
    ['Flächenkupplung 2-armig (90°)', 'black', 4],
    ['Platte 40 × 40 cm', 'yellow', 1],
    ['Rohrschraube', 'red', 4],
    ['Plattenschraube', 'black', 4],
  ]);
});

test('acceptance 6: a plate that fits only with a turned tube gets the turn, and the checker confirms it', () => {
  const core = build(square);
  const before = core.snapshot;
  const turned = spotsOf(core)
    .map((spot) => ({ spot, after: core.preview(insertPlate(before, spot, 'blue')) }))
    .find(({ after }) =>
      after.candidate?.realization.poses.some((p) => {
        const old = before.realization.poses.find((q) => q.partId === p.partId);
        return old && Math.abs(Math.abs(old.worldPose.orientation.w) - Math.abs(p.worldPose.orientation.w)) > 1e-6;
      }),
    );
  assert.ok(turned, 'some plate needs a tube turned about its axis');
  assert.equal(turned.after.status, 'valid');
});

test('acceptance 8: tubes too far apart for the plate holes give a plate-mount-conflict with the offset', () => {
  const core = build(square);
  const spot = spotsOf(core).find(top);
  const command = insertPlate(core.snapshot, { ...spot, familyId: 'panel-30-30cm' }, 'blue');
  const result = core.execute(command);
  assert.equal(result.ok, false);
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, 'plate-mount-conflict');
  assert.ok(diagnostic.details.lateralMm > 40, JSON.stringify(diagnostic.details));
});

test('a model with a plate comes back from its file unchanged', () => {
  const core = build(square);
  const saved = execute(core, insertPlate(core.snapshot, spotsOf(core).find(top), 'blue'));
  const opened = openConstruction(encodeConstruction(saved), quadroPartCatalog, options);
  assert.equal(opened.ok, true, JSON.stringify(opened.diagnostics));
  assert.deepEqual(opened.value.snapshot, JSON.parse(encodeConstruction(saved)).snapshot);
});

test('removing a flange tube takes the plate with it', () => {
  const core = build(square);
  const s = execute(
    core,
    insertPlate(
      core.snapshot,
      spotsOf(core).find((x) => top(x) && x.flangeTubes.includes('t1')),
      'blue',
    ),
  );
  const after = execute(core, removeTube(s, 't1'));
  assert.deepEqual(after.design.plates, []);
  assert.equal(after.realization.plateMounts.length, 0);
});

/** Cube of 35 cm tubes: floor j1–j4, posts up, top ring j5–j8. */
const cube = [
  ...square,
  ['j1', '+z'],
  ['j2', '+z'],
  ['j3', '+z'],
  ['j4', '+z'],
  ['j5', '+x'],
  ['j6', '+y'],
  ['j7', '-x'],
  ['j8', '-y'],
];
const posts = (core) => {
  const z = (j) => core.snapshot.realization.intentPoses.find((p) => p.intent.id === j).worldPose.position.z;
  return core.snapshot.design.tubes.filter((t) => Math.abs(z(t.a.junctionId) - z(t.b.junctionId)) > 1).map((t) => t.id);
};

test('a platform takes its floor on the inside and wall plates on the outside, screwed to the posts', () => {
  const core = build(cube);
  const upright = posts(core);
  assert.equal(upright.length, 4);
  const floor = spotsOf(core).find((s) => s.cellKey.includes('j1+j2+j3+j4') && s.cellKey.endsWith('00+'));
  execute(core, insertPlate(core.snapshot, floor, 'blue'));
  // Wall cells facing away from the cube centre (200, 200, 200).
  const outward = (spot) => {
    const { position: p, orientation } = spot.worldPose;
    const n = rotate(orientation, vec(0, 0, 1));
    return n.x * (p.x - 200) + n.y * (p.y - 200) + n.z * (p.z - 200) > 1;
  };
  const walls = [
    ...new Map(
      spotsOf(core)
        .filter((s) => outward(s) && s.flangeTubes.every((t) => upright.includes(t)))
        .map((s) => [s.cellKey, s]),
    ).values(),
  ];
  assert.equal(walls.length, 4);
  for (const wall of walls) {
    const now = spotsOf(core).find((s) => s.key === wall.key);
    execute(core, insertPlate(core.snapshot, now, 'green'));
  }
  // Each post carries two walls at right angles: tubes with two holes at 90°.
  const types = core.snapshot.realization.parts
    .filter((p) => p.origin.intent.kind === 'tube' && upright.includes(p.origin.intent.id))
    .map((p) => p.typeId);
  assert.deepEqual(types, Array(4).fill('tube-35cm-90deg-4hole'));
});

test('a wall plate inside next to the floor plate collides, as a stair riser would without bending', () => {
  const core = build(cube);
  const floor = spotsOf(core).find((s) => s.cellKey.includes('j1+j2+j3+j4') && s.cellKey.endsWith('00+'));
  execute(core, insertPlate(core.snapshot, floor, 'blue'));
  const inside = spotsOf(core).filter((s) => {
    const { position: p, orientation } = s.worldPose;
    const n = rotate(orientation, vec(0, 0, 1));
    return n.x * (p.x - 200) + n.y * (p.y - 200) + n.z * (p.z - 200) < -1;
  });
  // Inner walls only: neither the floor itself nor the ceiling.
  const walls = inside.filter((s) => s.cellKey !== floor.cellKey && !s.cellKey.endsWith('00-'));
  const results = walls.map((wall) => core.preview(insertPlate(core.snapshot, wall, 'green')));
  assert.equal(results.length, 8);
  for (const r of results) {
    assert.equal(r.status, 'invalid');
    assert.ok(r.diagnostics.some((d) => d.code === 'collision' || d.code === 'plate-mount-conflict'));
  }
});
