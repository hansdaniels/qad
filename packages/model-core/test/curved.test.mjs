import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  DEFAULT_TOLERANCE,
  attachTube,
  bendDirections,
  createModelCore,
  quadroCollisionGeometry,
  quadroConnectionEvaluators,
  quadroPartCatalog,
  turnTube,
} from '../src/index.ts';
import { vec } from '../src/math.ts';

const options = {
  tolerance: DEFAULT_TOLERANCE,
  connectionEvaluators: quadroConnectionEvaluators,
  geometry: quadroCollisionGeometry,
};

function start() {
  const created = createModelCore(
    {
      id: 'm',
      catalog: quadroPartCatalog.ref,
      tubes: [],
      junctions: [{ id: 'j1' }],
      plates: [],
      slides: [],
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
  return created.value;
}
const attach = (core, junctionId, direction, familyId = 'tube-35cm', bend) => {
  const command = attachTube(core.snapshot, { junctionId, direction }, { familyId, colour: 'red' }, quadroPartCatalog, {
    bend,
  });
  const result = core.execute(command);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.value;
};
const at = (s, id) => {
  const p = s.realization.intentPoses.find((x) => x.intent.id === id).worldPose.position;
  return [p.x, p.y, p.z].map((v) => Math.round(v) + 0);
};

test('a curved tube bends towards each perpendicular direction, also from an open end', () => {
  assert.deepEqual(bendDirections('+x'), ['+z', '+y', '-y', '-z']);
  const expected = { '+z': [400, 0, 400], '+y': [400, 400, 0], '-y': [400, -400, 0], '-z': [400, 0, -400] };
  for (const bend of bendDirections('+x')) {
    const s = attach(start(), 'j1', '+x', 'curved-tube', bend);
    assert.deepEqual(at(s, 'j2'), expected[bend], bend);
  }
});

test('a curved tube on a connector arm bends the chosen way and closes a frame corner', () => {
  const core = start();
  attach(core, 'j1', '+y');
  attach(core, 'j2', '+x');
  // From j1 along +x, bending up to +y: lands on j3 at (400, 400, 0) and closes the ring.
  const s = attach(core, 'j1', '+x', 'curved-tube', '+y');
  assert.equal(s.design.junctions.length, 3);
  const curved = s.design.tubes.find((t) => t.familyId === 'curved-tube');
  assert.equal(curved.b.junctionId, 'j3');
  assert.ok(s.realization.parts.some((p) => p.typeId === 'curved-tube'));
});

test('a curved tube turns through the other bend directions and drops its old far junction', () => {
  const core = start();
  attach(core, 'j1', '+x', 'curved-tube', '+z');
  const commands = turnTube(core.snapshot, 't1', quadroPartCatalog);
  assert.equal(commands.length, 3);
  const s = core.execute(commands[0]);
  assert.equal(s.ok, true, JSON.stringify(s.diagnostics));
  assert.deepEqual(
    s.value.design.tubes.map((t) => t.id),
    ['t1'],
  );
  // Next after +z is +y; the old far junction j2 goes, the new one takes its place.
  assert.equal(s.value.design.junctions.length, 2);
  const far = s.value.design.tubes[0].b.junctionId;
  assert.deepEqual(at(s.value, far), [400, 400, 0]);
  // Turning on comes back round to the start.
  for (let i = 0; i < 3; i++) assert.equal(core.execute(turnTube(core.snapshot, 't1', quadroPartCatalog)[0]).ok, true);
  assert.deepEqual(at(core.snapshot, core.snapshot.design.tubes[0].b.junctionId), [400, 0, 400]);
});
