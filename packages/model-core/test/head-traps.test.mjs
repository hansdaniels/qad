import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  DEFAULT_TOLERANCE,
  attachTube,
  createModelCore,
  findHeadTraps,
  insertPlate,
  plateSpots,
  quadroCollisionGeometry,
  quadroConnectionEvaluators,
  quadroPartCatalog,
} from '../src/index.ts';
import { vec } from '../src/math.ts';

function build(steps) {
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
    {
      tolerance: DEFAULT_TOLERANCE,
      connectionEvaluators: quadroConnectionEvaluators,
      geometry: quadroCollisionGeometry,
    },
  );
  const core = created.value;
  for (const [junctionId, direction, familyId] of steps) {
    const command = attachTube(
      core.snapshot,
      { junctionId, direction },
      { familyId, colour: 'red' },
      quadroPartCatalog,
    );
    const result = core.execute(command);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  }
  return core;
}

/** A 35 × 15 frame starting at the given junction; ids follow on from earlier steps. */
const frame = (start, next) => [
  [start, '+x', 'tube-35cm'],
  [`j${next}`, '+y', 'tube-15cm'],
  [`j${next + 1}`, '-x', 'tube-35cm'],
  [`j${next + 2}`, '-y', 'tube-15cm'],
];
const traps = (core) => findHeadTraps(core.snapshot, quadroPartCatalog);

test('a 35 × 15 frame on the floor is no head trap', () => {
  assert.deepEqual(traps(build(frame('j1', 2))), []);
});

test('the same frame 80 cm up is a possible head trap between its long tubes', () => {
  const core = build([['j1', '+z', 'tube-35cm'], ['j2', '+z', 'tube-35cm'], ...frame('j3', 4)]);
  const found = traps(core);
  assert.equal(found.length, 1);
  const [trap] = found;
  const long = core.snapshot.design.tubes.filter((t) => t.familyId === 'tube-35cm').map((t) => t.id);
  assert.ok(trap.tubes.every((t) => long.includes(t)));
  assert.equal(Math.round(trap.clearWidthMm), 150);
  // Axes 800 above the anchor; the floor is the underside of its connector.
  assert.equal(Math.round(trap.heightMm), 825);
  assert.deepEqual(
    trap.partIds,
    trap.tubes.map((t) => `tube:${t}/body`),
  );
});

test('a plate screwed to both tubes closes the opening', () => {
  const core = build([['j1', '+z', 'tube-35cm'], ['j2', '+z', 'tube-35cm'], ...frame('j3', 4)]);
  const [trap] = traps(core);
  const spot = plateSpots(core.snapshot, quadroPartCatalog).find(
    (s) => s.familyId === 'panel-40-20cm' && trap.tubes.every((t) => s.flangeTubes.includes(t)),
  );
  assert.ok(spot);
  const result = core.execute(insertPlate(core.snapshot, spot, 'blue'));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(traps(core), []);
});

test('a half plate screwed to the short tubes closes the opening as well, like a stair riser', () => {
  const core = build([['j1', '+z', 'tube-35cm'], ['j2', '+z', 'tube-35cm'], ...frame('j3', 4)]);
  const [trap] = traps(core);
  const spot = plateSpots(core.snapshot, quadroPartCatalog).find(
    (s) => s.familyId === 'panel-40-20cm' && !trap.tubes.some((t) => s.flangeTubes.includes(t)),
  );
  assert.equal(spot.typeId, 'panel-40-20cm/short');
  const result = core.execute(insertPlate(core.snapshot, spot, 'blue'));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(traps(core), []);
});

test('a 35 × 35 frame up high leaves too wide a gap for a head trap', () => {
  const square = [
    ['j3', '+x', 'tube-35cm'],
    ['j4', '+y', 'tube-35cm'],
    ['j5', '-x', 'tube-35cm'],
    ['j6', '-y', 'tube-35cm'],
  ];
  assert.deepEqual(traps(build([['j1', '+z', 'tube-35cm'], ['j2', '+z', 'tube-35cm'], ...square])), []);
});
