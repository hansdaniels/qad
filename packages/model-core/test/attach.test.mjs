import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  DEFAULT_TOLERANCE,
  attachPoints,
  attachTube,
  createModelCore,
  nextId,
  quadroCollisionGeometry,
  quadroConnectionEvaluators,
  quadroPartCatalog,
} from '../src/index.ts';
import { vec } from '../src/math.ts';

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

const attach = (core, junctionId, direction, familyId = 'tube-35cm') => {
  const result = core.execute(attachTube(core.snapshot, { junctionId, direction }, { familyId, colour: 'red' }));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.value;
};
const free = (snapshot, junctionId) =>
  attachPoints(snapshot, quadroPartCatalog)
    .filter((p) => p.junctionId === junctionId)
    .map((p) => p.direction);

test('a lone anchored junction offers no arms; a tube end offers all directions but its own', () => {
  const core = start();
  assert.deepEqual(attachPoints(core.snapshot, quadroPartCatalog), []);
  const s = attach(core, 'j1', '+x');
  assert.deepEqual(free(s, 'j1'), ['-x', '+y', '-y', '+z', '-z']);
  assert.deepEqual(free(s, 'j2'), ['+x', '+y', '-y', '+z', '-z']);
});

test('the arm sits on the shoulder one arm length from the junction, pointing outwards', () => {
  const core = start();
  const s = attach(core, 'j1', '+x');
  const up = attachPoints(s, quadroPartCatalog).find((p) => p.junctionId === 'j2' && p.direction === '+z');
  assert.ok(Math.hypot(up.worldPose.position.x - 400, up.worldPose.position.y, up.worldPose.position.z - 25) < 1e-6);
});

test('attaching at a free arm builds a frame step by step with new IDs', () => {
  const core = start();
  attach(core, 'j1', '+x');
  attach(core, 'j2', '+y');
  attach(core, 'j3', '-x');
  const s = core.snapshot;
  assert.deepEqual(
    s.design.tubes.map((t) => t.id),
    ['t1', 't2', 't3'],
  );
  assert.deepEqual(free(s, 'j2'), ['+x', '-y', '+z', '-z']);
  const j4 = s.realization.intentPoses.find((p) => p.intent.id === 'j4').worldPose.position;
  assert.ok(Math.hypot(j4.x, j4.y - 400, j4.z) < 1e-6);
});

test('an arm carrying an angle adapter is occupied', () => {
  const core = start();
  attach(core, 'j1', '+x');
  // Oblique tube up and outwards at j2: the solver puts the angle adapter on the -z arm.
  const q = { x: 0, y: Math.sin(Math.PI / 8), z: 0, w: Math.cos(Math.PI / 8) };
  const back = { x: 0, y: Math.sin((5 * Math.PI) / 8), z: 0, w: Math.cos((5 * Math.PI) / 8) };
  const result = core.execute({
    baseRevision: core.snapshot.revision,
    operations: [
      { kind: 'add-junction', junction: { id: 'j9' } },
      {
        kind: 'add-tube',
        tube: {
          id: 't9',
          familyId: 'tube-35cm',
          a: { junctionId: 'j2', orientation: q, roll: { mode: 'free' } },
          b: { junctionId: 'j9', orientation: back, roll: { mode: 'free' } },
          variant: { mode: 'automatic' },
          appearance: { colour: 'blue' },
        },
      },
    ],
  });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(free(core.snapshot, 'j2'), ['+x', '+y', '-y', '+z']);
});

test('next IDs continue the numbering', () => {
  assert.equal(nextId('t', ['t1', 't7', 'x3']), 't8');
  assert.equal(nextId('j', []), 'j1');
});
