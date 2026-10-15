import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  DEFAULT_TOLERANCE,
  attachTube,
  billOfMaterials,
  createModelCore,
  quadroArticleCatalog,
  quadroCollisionGeometry,
  quadroConnectionEvaluators,
  quadroPartCatalog,
} from '../src/index.ts';
import { qaxisAngle, vec } from '../src/math.ts';

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
    {
      tolerance: DEFAULT_TOLERANCE,
      connectionEvaluators: quadroConnectionEvaluators,
      geometry: quadroCollisionGeometry,
    },
  );
  const core = created.value;
  for (const [junctionId, direction, colour] of steps) {
    const command = attachTube(
      core.snapshot,
      { junctionId, direction },
      { familyId: 'tube-35cm', colour },
      quadroPartCatalog,
    );
    assert.equal(core.execute(command).ok, true);
  }
  return core.snapshot;
}

const summary = (lines) => lines.map((l) => [l.name, l.colour, l.quantity]);

test('a closed frame needs four tubes, four elbows and a screw per tube end', () => {
  const s = build([
    ['j1', '+x', 'green'],
    ['j2', '+y', 'green'],
    ['j3', '-x', 'green'],
    ['j4', '-y', 'green'],
  ]);
  assert.deepEqual(summary(billOfMaterials(s, quadroArticleCatalog)), [
    ['Rohr 35 cm', 'green', 4],
    ['Flächenkupplung 2-armig (90°)', 'black', 4],
    ['Rohrschraube', 'green', 8],
  ]);
});

test('open tube ends need no screw; screws take the colour of their tube', () => {
  const s = build([
    ['j1', '+x', 'red'],
    ['j2', '+y', 'blue'],
  ]);
  const lines = billOfMaterials(s, quadroArticleCatalog);
  const screws = lines.filter((l) => l.category === 'fastener').map((l) => [l.colour, l.quantity]);
  assert.deepEqual(screws, [
    ['blue', 1],
    ['red', 1],
  ]);
  const tubes = lines.filter((l) => l.category === 'tube');
  assert.deepEqual(
    tubes.map((l) => [l.colour, l.partIds]),
    [
      ['blue', ['tube:t2/body']],
      ['red', ['tube:t1/body']],
    ],
  );
});

test('an angle adapter is fixed with one black plate screw at its sleeve', () => {
  const s = build([['j1', '+x', 'red']]);
  const created = createModelCore(s.design, quadroPartCatalog, {
    tolerance: DEFAULT_TOLERANCE,
    connectionEvaluators: quadroConnectionEvaluators,
    geometry: quadroCollisionGeometry,
  });
  const core = created.value;
  const end = (junctionId, angle) => ({
    junctionId,
    orientation: qaxisAngle(vec(0, 1, 0), angle),
    roll: { mode: 'free' },
  });
  const result = core.execute({
    baseRevision: core.snapshot.revision,
    operations: [
      { kind: 'add-junction', junction: { id: 'j9' } },
      {
        kind: 'add-tube',
        tube: {
          id: 't9',
          familyId: 'tube-35cm',
          a: end('j2', Math.PI / 4),
          b: end('j9', (5 * Math.PI) / 4),
          variant: { mode: 'automatic' },
          appearance: { colour: 'blue' },
        },
      },
    ],
  });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const fasteners = billOfMaterials(result.value, quadroArticleCatalog)
    .filter((l) => l.category === 'fastener')
    .map((l) => [l.name, l.colour, l.quantity]);
  assert.deepEqual(fasteners, [
    ['Rohrschraube', 'blue', 1],
    ['Rohrschraube', 'red', 1],
    ['Plattenschraube', 'black', 1],
  ]);
});
