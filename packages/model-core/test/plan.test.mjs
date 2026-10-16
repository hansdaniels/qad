import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vite-plus/test';
import {
  DEFAULT_TOLERANCE,
  checkBuildability,
  encodeConstruction,
  importPlan,
  isPlan,
  openConstruction,
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
const load = (plan) =>
  importPlan(typeof plan === 'string' ? plan : JSON.stringify(plan), quadroPartCatalog, quadroArticleCatalog, options);
const plan = (steps) => ({ format: 'qad-bauplan', version: 1, start: 'A', steps });
const tube = (from, direction, to, part = 'tube-35cm', extra = {}) => ({
  kind: 'tube',
  part,
  from,
  direction,
  ...(to ? { to } : {}),
  ...extra,
});
const square = [tube('A', '+x', 'B'), tube('B', '+y', 'C'), tube('C', '-x', 'D'), tube('D', '-y', 'A')];
const message = (result) => {
  assert.equal(result.ok, false);
  return result.diagnostics.map((d) => d.message).join(' ');
};
const position = (core, junctionId) => {
  const p = core.snapshot.realization.intentPoses.find(
    (pose) => pose.intent.kind === 'junction' && pose.intent.id === junctionId,
  ).worldPose.position;
  return [p.x, p.y, p.z].map((v) => Math.round(v) + 0);
};

test('the examples in BAUPLAN.md build buildable models; the first saves and opens again', () => {
  const doc = readFileSync(new URL('../../../BAUPLAN.md', import.meta.url), 'utf8');
  const examples = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.equal(examples.length, 2);
  for (const example of examples) {
    assert.ok(isPlan(example));
    const built = load(example);
    assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
    const verdict = checkBuildability(built.value.snapshot, quadroPartCatalog, quadroCollisionGeometry, {
      ...options,
      minClearanceMm: 0,
      maxRemediesPerFinding: 0,
    }).verdict;
    assert.equal(verdict, 'buildable');
  }
  assert.equal(load(examples[1]).value.snapshot.design.slides.length, 2);
  const result = load(examples[0]);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const { snapshot } = result.value;
  assert.equal(snapshot.design.tubes.length, 13);
  assert.equal(snapshot.design.plates.length, 2);
  assert.equal(snapshot.design.junctions.length, 9);
  const report = checkBuildability(snapshot, quadroPartCatalog, quadroCollisionGeometry, {
    ...options,
    minClearanceMm: 0,
    maxRemediesPerFinding: 0,
  });
  assert.equal(report.verdict, 'buildable', JSON.stringify(report.findings.map((f) => f.diagnostic.message)));
  assert.equal(openConstruction(encodeConstruction(snapshot), quadroPartCatalog, options).ok, true);
  assert.deepEqual(
    result.diagnostics.map((d) => [d.severity, d.message]),
    [['warning', 'Farbe des Bogenrohrs auf dem Foto nicht sicher erkennbar.']],
  );
});

test('a closed square reuses the start point and points sit one grid step apart', () => {
  const result = load(plan(square));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const core = result.value;
  assert.equal(core.snapshot.design.junctions.length, 4);
  assert.deepEqual(position(core, 'j3'), [400, 400, 0]);
});

test('a curved tube ends 40 cm on along its start and its bend direction', () => {
  const result = load(plan([tube('A', '+x', 'B', 'curved-tube', { bend: '+z' })]));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(position(result.value, 'j2'), [400, 0, 400]);
});

test('an oblique tube takes an angle adapter on the free arm that suits it', () => {
  const result = load(plan([...square, tube('B', '+x+z', 'E')]));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const oblique = result.value.snapshot.design.tubes.at(-1);
  // -x at B is taken by the first tube, so the adapter sits on -z and leans to +x.
  assert.equal(oblique.a.adapterArm, '-z');
});

test('steps that cannot be built are named with their number and reason', () => {
  assert.match(message(load(plan([tube('B', '+x')]))), /^Schritt 1: Punkt „B“ ist noch nicht gebaut/);
  assert.match(message(load(plan([tube('A', '+x', 'B', 'tube-36cm')]))), /Unbekanntes Rohr „tube-36cm“/);
  assert.match(
    message(
      load(plan([tube('A', '+x', 'B'), tube('B', '+y', 'C'), tube('C', '-x', 'D', 'tube-15cm'), tube('D', '-y', 'A')])),
    ),
    /^Schritt 4: Das Rohrende trifft Punkt „A“ nicht \(200 mm daneben\)/,
  );
  assert.match(
    message(load(plan([tube('A', '+x', 'B'), tube('B', '+y', 'C'), tube('C', '-x', 'D'), tube('D', '-y', 'E')]))),
    /Schritt 4: Das Rohrende trifft den vorhandenen Punkt „A“/,
  );
  assert.match(message(load(plan([tube('A', '+x', 'B'), tube('A', '+x', 'C')]))), /Schritt 2: .*\+x schon belegt/);
  assert.match(message(load(plan([tube('A', '+x', 'B', 'curved-tube')]))), /braucht „bend“/);
  assert.match(
    message(load(plan([tube('A', '+x', 'B', 'tube-52cm', { colour: 'pearl-white' })]))),
    /„tube-52cm“ gibt es nicht in „pearl-white“/,
  );
});

test('plates need a frame of their size on the stated side', () => {
  const plate = (part, side, extra = {}) => ({ kind: 'plate', part, corners: ['A', 'B', 'C', 'D'], side, ...extra });
  const ok = load(plan([...square, plate('panel-40-40cm', '-z', { colour: 'red' })]));
  assert.equal(ok.ok, true, JSON.stringify(ok.diagnostics));
  assert.equal(ok.value.snapshot.design.plates[0].appearance.colour, 'red');
  assert.match(message(load(plan([...square, plate('panel-40-20cm', '+z')]))), /keinen freien Rahmen/);
  assert.match(
    message(load(plan([...square, plate('panel-40-40cm', '+x')]))),
    /Seite \+x .* möglich ist (\+z oder -z|-z oder \+z)/,
  );
});

test('only building plans are taken for one; format errors name the field', () => {
  assert.equal(isPlan('{"format":"qad-construction"}'), false);
  assert.equal(isPlan('kein JSON'), false);
  assert.match(
    message(load({ ...plan([]), steps: [{ kind: 'tube', part: 'tube-35cm', from: 'A', direction: 'rechts' }] })),
    /steps\.0\.direction/,
  );
});
