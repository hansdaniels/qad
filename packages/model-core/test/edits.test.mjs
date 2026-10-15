import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  DEFAULT_TOLERANCE,
  attachTube,
  createModelCore,
  findOpenEnds,
  quadroCollisionGeometry,
  quadroConnectionEvaluators,
  quadroPartCatalog,
  recolourTube,
  removeTube,
  resolveArticle,
  quadroArticleCatalog,
  tubeOfPart,
} from '../src/index.ts';
import { qaxisAngle, vec } from '../src/math.ts';

const options = {
  tolerance: DEFAULT_TOLERANCE,
  connectionEvaluators: quadroConnectionEvaluators,
  geometry: quadroCollisionGeometry,
};
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

function start() {
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
          worldPose: { position: vec(0, 0, 0), orientation: IDENTITY },
        },
      ],
    },
    quadroPartCatalog,
    options,
  );
  assert.equal(created.ok, true);
  return created.value;
}
const exec = (core, command) => {
  const result = core.execute(command);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.value;
};
const attach = (core, junctionId, direction) =>
  exec(
    core,
    attachTube(core.snapshot, { junctionId, direction }, { familyId: 'tube-35cm', colour: 'red' }, quadroPartCatalog),
  );
const position = (s, junctionId) =>
  s.realization.intentPoses.find((p) => p.intent.id === junctionId)?.worldPose.position;

test('removing the only tube leaves the anchored junction and drops the free end', () => {
  const core = start();
  attach(core, 'j1', '+x');
  const s = exec(core, removeTube(core.snapshot, 't1'));
  assert.deepEqual(
    s.design.junctions.map((j) => j.id),
    ['j1'],
  );
  assert.equal(s.realization.parts.length, 0);
});

test('removing a tube from a ring keeps everything else in place', () => {
  const core = start();
  attach(core, 'j1', '+x');
  attach(core, 'j2', '+y');
  attach(core, 'j3', '-x');
  const ring = attach(core, 'j4', '-y');
  const s = exec(core, removeTube(ring, 't2'));
  assert.equal(s.design.anchors.length, 1);
  const [a, b] = [position(s, 'j3'), position(ring, 'j3')];
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6);
  assert.equal(findOpenEnds(s.design).length, 2);
});

test('a model falling apart keeps the detached part where it was with a new anchor', () => {
  const core = start();
  attach(core, 'j1', '+x');
  const line = attach(core, 'j2', '+x');
  const s = exec(core, removeTube(line, 't1'));
  assert.deepEqual(
    s.design.anchors.map((a) => a.target),
    [
      { kind: 'junction', id: 'j1' },
      { kind: 'junction', id: 'j2' },
    ],
  );
  const before = line.realization.poses.find((p) => p.partId === 'tube:t2/body').worldPose.position;
  const after = s.realization.poses.find((p) => p.partId === 'tube:t2/body').worldPose.position;
  assert.ok(Math.hypot(before.x - after.x, before.y - after.y, before.z - after.z) < 1e-6);
});

test('recolouring a tube changes its article', () => {
  const core = start();
  attach(core, 'j1', '+x');
  const s = exec(core, recolourTube(core.snapshot, 't1', 'pearl-white'));
  assert.equal(s.design.tubes[0].appearance.colour, 'pearl-white');
  assert.equal(resolveArticle(quadroArticleCatalog, 'tube-35cm', 'pearl-white').article.articleNumber, '70082');
});

test('parts map to the tube they stand for; connectors to none', () => {
  const core = start();
  attach(core, 'j1', '+x');
  const s = attach(core, 'j2', '+y');
  assert.equal(tubeOfPart(s, 'tube:t2/body'), 't2');
  assert.equal(tubeOfPart(s, 'junction:j2/connector'), undefined);
  const adapter = {
    ...s,
    realization: {
      ...s.realization,
      parts: [
        ...s.realization.parts,
        {
          id: 'x',
          typeId: 'diagonal-connector',
          origin: { intent: { kind: 'junction', id: 'j2' }, role: 'angle-adapter:t9:a' },
        },
      ],
    },
  };
  assert.equal(tubeOfPart(adapter, 'x'), 't9');
});

test('an angle adapter keeps its arm when a neighbouring arm becomes free', () => {
  const core = start();
  attach(core, 'j1', '+x');
  attach(core, 'j2', '+y');
  const oblique = (angle) => ({
    junctionId: 'x',
    orientation: qaxisAngle(vec(0, 1, 0), angle),
    roll: { mode: 'free' },
  });
  const before = exec(core, {
    baseRevision: core.snapshot.revision,
    operations: [
      { kind: 'add-junction', junction: { id: 'j9' } },
      {
        kind: 'add-tube',
        tube: {
          id: 't9',
          familyId: 'tube-35cm',
          a: { ...oblique(Math.PI / 4), junctionId: 'j2' },
          b: { ...oblique((5 * Math.PI) / 4), junctionId: 'j9' },
          variant: { mode: 'automatic' },
          appearance: { colour: 'blue' },
        },
      },
    ],
  });
  const after = exec(core, removeTube(before, 't1'));
  const [a, b] = [position(after, 'j9'), position(before, 'j9')];
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.01, JSON.stringify({ a, b }));
});
