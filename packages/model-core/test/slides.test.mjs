import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  DEFAULT_TOLERANCE,
  billOfMaterials,
  checkBuildability,
  encodeConstruction,
  importPlan,
  insertSlide,
  openConstruction,
  quadroArticleCatalog,
  quadroCollisionGeometry,
  quadroConnectionEvaluators,
  quadroPartCatalog,
  removeTube,
  slideSpots,
} from '../src/index.ts';

const options = {
  tolerance: DEFAULT_TOLERANCE,
  connectionEvaluators: quadroConnectionEvaluators,
  geometry: quadroCollisionGeometry,
};
const tube = (from, direction, to, part = 'tube-35cm') => ({ kind: 'tube', part, from, direction, to });
const ring = (z) => [
  tube(`0/0/${z}`, '+x', `40/0/${z}`),
  tube(`40/0/${z}`, '+y', `40/40/${z}`),
  tube(`40/40/${z}`, '-x', `0/40/${z}`),
  tube(`0/40/${z}`, '-y', `0/0/${z}`),
];
const posts = (from, to) => ['0/0', '40/0', '40/40', '0/40'].map((xy) => tube(`${xy}/${from}`, '+z', `${xy}/${to}`));
const rail = (y) => [
  tube(`40/${y}/0`, '+x', `80/${y}/0`),
  tube(`80/${y}/0`, '+x', `120/${y}/0`),
  tube(`120/${y}/0`, '+x', `160/${y}/0`),
];
/** Tower of two storeys with rails running three cells out to a cross tube. */
const TOWER = [
  ...ring(0),
  ...posts(0, 40),
  ...ring(40),
  ...posts(40, 80),
  ...ring(80),
  ...rail(0),
  ...rail(40),
  tube('160/0/0', '+y', '160/40/0'),
];

function tower() {
  const result = importPlan(
    JSON.stringify({ format: 'qad-bauplan', version: 1, start: '0/0/0', steps: TOWER }),
    quadroPartCatalog,
    quadroArticleCatalog,
    options,
  );
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.value;
}
const tubeAt = (core, x) => {
  const poses = core.snapshot.realization.intentPoses;
  const at = (id) => poses.find((p) => p.intent.kind === 'junction' && p.intent.id === id).worldPose.position;
  return core.snapshot.design.tubes.find((t) => {
    const [a, b] = [at(t.a.junctionId), at(t.b.junctionId)];
    return (
      Math.round(a.x) === x &&
      Math.round(b.x) === x &&
      Math.round(a.y) !== Math.round(b.y) &&
      Math.round(a.z) === Math.round(b.z) &&
      Math.round(a.z) === (x === 400 ? 800 : 0)
    );
  }).id;
};
const execute = (core, command) => {
  const result = core.execute(command);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
};
const check = (core) =>
  checkBuildability(core.snapshot, quadroPartCatalog, quadroCollisionGeometry, {
    ...options,
    minClearanceMm: 0,
    maxRemediesPerFinding: 0,
  });

test('a slide body hangs on the top front tube of a tower and rests on the cross tube three cells out', () => {
  const core = tower();
  const spots = slideSpots(core.snapshot, quadroPartCatalog);
  const top = tubeAt(core, 400);
  const body = spots.filter((s) => s.familyId === 'modular-slide-body');
  // Only the top tube has a parallel tube two storeys down and three cells out.
  assert.deepEqual(
    body.map((s) => [s.tubeId, s.toward]),
    [[top, '+x']],
  );
  // No body yet, so no runout either.
  assert.equal(spots.filter((s) => s.familyId === 'slide-runout').length, 0);
  execute(core, insertSlide(core.snapshot, body[0], 'red'));
  const part = core.snapshot.realization.parts.find((p) => p.origin.intent.kind === 'slide');
  assert.equal(part.typeId, 'modular-slide-body');
  const pose = core.snapshot.realization.poses.find((p) => p.partId === part.id).worldPose;
  assert.deepEqual(
    [pose.position.x, pose.position.y, pose.position.z].map((v) => Math.round(v) + 0),
    [400, 200, 800],
  );
  const report = check(core);
  assert.equal(report.verdict, 'buildable', JSON.stringify(report.findings.map((f) => f.diagnostic.message)));

  // Now the runout can follow on the cross tube.
  const runout = slideSpots(core.snapshot, quadroPartCatalog).filter((s) => s.familyId === 'slide-runout');
  assert.deepEqual(
    runout.map((s) => [s.tubeId, s.toward]),
    [[tubeAt(core, 1600), '+x']],
  );
  execute(core, insertSlide(core.snapshot, runout[0], 'yellow'));
  assert.equal(check(core).verdict, 'buildable');

  const bill = billOfMaterials(core.snapshot, quadroArticleCatalog, quadroPartCatalog);
  const count = (name) => bill.filter((l) => l.name === name).reduce((n, l) => n + l.quantity, 0);
  assert.equal(count('Modularrutschen-Körper'), 1);
  assert.equal(count('Rutschenauslauf'), 1);
  assert.equal(count('Konische Rutschenschraube'), 4);
  assert.equal(count('Rutschenschraube'), 1);
  assert.equal(count('Rutschenschraube Gegenstück'), 2);

  // Saved and opened again with the same parts.
  const reopened = openConstruction(encodeConstruction(core.snapshot), quadroPartCatalog, options);
  assert.equal(reopened.ok, true, JSON.stringify(reopened.diagnostics));
  assert.equal(reopened.value.snapshot.design.slides.length, 2);
});

test('removing the tube a slide hangs on removes the slide; the body cannot lose its rest', () => {
  const core = tower();
  const [spot] = slideSpots(core.snapshot, quadroPartCatalog);
  execute(core, insertSlide(core.snapshot, spot, 'red'));
  const without = core.preview(removeTube(core.snapshot, tubeAt(core, 400)));
  assert.equal(without.status, 'valid');
  assert.equal(without.candidate.design.slides.length, 0);
  const unsupported = core.preview(removeTube(core.snapshot, tubeAt(core, 1600)));
  assert.equal(unsupported.status, 'invalid');
  assert.match(unsupported.diagnostics.map((d) => d.message).join(' '), /liegt unten auf keinem Rohr auf/);
});

test('a slide needs a horizontal tube across its direction', () => {
  const core = tower();
  const post = core.snapshot.design.tubes.find((t) => t.a.orientation.w !== 1 && t.familyId === 'tube-35cm');
  const result = core.preview({
    baseRevision: core.snapshot.revision,
    operations: [
      {
        kind: 'add-slide',
        slide: {
          id: 's1',
          familyId: 'modular-slide-body',
          tubeId: tubeAt(core, 400),
          toward: '+y',
          appearance: { colour: 'red' },
        },
      },
    ],
  });
  assert.equal(result.status, 'invalid');
  assert.match(result.diagnostics[0].message, /waagerechtes Rohr quer zur Richtung \+y/);
  assert.ok(post);
});
