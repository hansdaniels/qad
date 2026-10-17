import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  DEFAULT_TOLERANCE,
  assemblyOf,
  attachTube,
  connectionSnaps,
  importPlan,
  moveAssembly,
  quadroArticleCatalog,
  quadroCollisionGeometry,
  quadroConnectionEvaluators,
  quadroPartCatalog,
} from '../src/index.ts';

const options = {
  tolerance: DEFAULT_TOLERANCE,
  connectionEvaluators: quadroConnectionEvaluators,
  geometry: quadroCollisionGeometry,
};
const tube = (from, direction, to, part = 'tube-35cm') => ({ kind: 'tube', part, from, direction, to });
const square = (x) => [
  tube(`${x}/0/0`, '+x', `${x + 40}/0/0`),
  tube(`${x + 40}/0/0`, '+y', `${x + 40}/40/0`),
  tube(`${x + 40}/40/0`, '-x', `${x}/40/0`),
  tube(`${x}/40/0`, '-y', `${x}/0/0`),
];
/** A square frame and, loose beside it, a second one 1.20 m further along x. */
function twoFrames() {
  const result = importPlan(
    JSON.stringify({
      format: 'qad-bauplan',
      version: 1,
      start: '0/0/0',
      steps: [...square(0), { kind: 'point', name: '160/0/0', at: [160, 0, 0] }, ...square(160)],
    }),
    quadroPartCatalog,
    quadroArticleCatalog,
    options,
  );
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.value;
}
const loose = (core) => {
  const part = core.snapshot.realization.parts.find((p) => p.id === 'tube:t5/body');
  return assemblyOf(core.snapshot, part.id);
};
const positionOf = (snapshot, junctionId) => {
  const p = snapshot.realization.intentPoses.find((x) => x.intent.kind === 'junction' && x.intent.id === junctionId)
    .worldPose.position;
  return [p.x, p.y, p.z].map((v) => Math.round(v) + 0);
};

test('an assembly holds what tubes join, and only that', () => {
  const core = twoFrames();
  const assembly = loose(core);
  assert.deepEqual([...assembly.tubeIds].sort(), ['t5', 't6', 't7', 't8']);
  assert.equal(assembly.junctionIds.length, 4);
  assert.equal(assembly.anchorId, 'anchor1');
  assert.ok(assembly.partIds.includes('tube:t5/body'));
  assert.ok(!assembly.partIds.includes('tube:t1/body'));
});

test('moving an assembly changes its anchor only; IDs and relations stay', () => {
  const core = twoFrames();
  const before = core.snapshot;
  const result = core.execute(
    moveAssembly(before, loose(core), { translation: { x: 400, y: 0, z: 0 }, quarterTurns: 0 }),
  );
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const after = result.value;
  assert.deepEqual(after.design.tubes, before.design.tubes);
  assert.deepEqual(
    after.realization.parts.map((p) => p.id),
    before.realization.parts.map((p) => p.id),
  );
  assert.deepEqual(positionOf(after, 'j5'), [2000, 0, 0]);
  assert.deepEqual(positionOf(after, 'j1'), [0, 0, 0]);
});

test('a quarter turn keeps the assembly on the grid; moving into the other one is refused', () => {
  const core = twoFrames();
  const turned = core.preview(
    moveAssembly(core.snapshot, loose(core), { translation: { x: 0, y: 0, z: 0 }, quarterTurns: 1 }),
  );
  assert.equal(turned.status, 'valid', JSON.stringify(turned.diagnostics));
  for (const p of turned.candidate.realization.intentPoses) {
    for (const v of Object.values(p.worldPose.position)) assert.ok(Math.abs(v / 200 - Math.round(v / 200)) < 1e-6);
  }
  const onto = core.preview(
    moveAssembly(core.snapshot, loose(core), { translation: { x: -1600, y: 0, z: 0 }, quarterTurns: 0 }),
  );
  assert.equal(onto.status, 'invalid');
});

test('snapping offers the place where a 25 cm tube joins the two, and then it does', () => {
  const core = twoFrames();
  const assembly = loose(core);
  const snaps = connectionSnaps(core.snapshot, quadroPartCatalog, assembly, 0);
  // The facing corners are 1.20 m apart; a 25 cm tube spans 30 cm between centres,
  // so the loose frame moves 90 cm closer.
  const snap = snaps.find(
    (s) => s.familyId === 'tube-25cm' && Math.round(s.translation.y) === 0 && Math.round(s.translation.x) === -900,
  );
  assert.ok(snap, JSON.stringify(snaps.filter((s) => s.familyId === 'tube-25cm').slice(0, 4)));
  const moved = core.execute(moveAssembly(core.snapshot, assembly, { translation: snap.translation, quarterTurns: 0 }));
  assert.equal(moved.ok, true, JSON.stringify(moved.diagnostics));
  const join = core.execute(
    attachTube(core.snapshot, snap.to, { familyId: 'tube-25cm', colour: 'red' }, quadroPartCatalog),
  );
  assert.equal(join.ok, true, JSON.stringify(join.diagnostics));
  assert.equal(core.snapshot.design.anchors.length, 1);
});

test('snapping also lifts: the loose frame fits on top of the other with 35 cm posts', () => {
  const core = twoFrames();
  const assembly = loose(core);
  assert.equal(Math.round(assembly.lowest) + 0, 0);
  const lift = connectionSnaps(core.snapshot, quadroPartCatalog, assembly, 0).find(
    (s) =>
      s.familyId === 'tube-35cm' &&
      [s.translation.x, s.translation.y, s.translation.z].map((v) => Math.round(v) + 0).join() === '-1600,0,400',
  );
  assert.ok(lift);
  const moved = core.execute(moveAssembly(core.snapshot, assembly, { translation: lift.translation, quarterTurns: 0 }));
  assert.equal(moved.ok, true, JSON.stringify(moved.diagnostics));
  assert.deepEqual(positionOf(core.snapshot, 'j5'), [0, 0, 400]);
});
