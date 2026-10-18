import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  DEFAULT_TOLERANCE,
  assemblyOf,
  attachTube,
  compareConstructions,
  importPlan,
  moveAssembly,
  quadroArticleCatalog,
  quadroCollisionGeometry,
  quadroConnectionEvaluators,
  quadroPartCatalog,
  removeTube,
} from '../src/index.ts';

const options = {
  tolerance: DEFAULT_TOLERANCE,
  connectionEvaluators: quadroConnectionEvaluators,
  geometry: quadroCollisionGeometry,
};
const tube = (from, direction, to) => ({ kind: 'tube', part: 'tube-35cm', from, direction, to });
const load = (steps) => {
  const result = importPlan(
    JSON.stringify({ format: 'qad-bauplan', version: 1, start: '0/0/0', steps }),
    quadroPartCatalog,
    quadroArticleCatalog,
    options,
  );
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.value;
};
const square = [
  tube('0/0/0', '+x', '40/0/0'),
  tube('40/0/0', '+y', '40/40/0'),
  tube('40/40/0', '-x', '0/40/0'),
  tube('0/40/0', '-y', '0/0/0'),
];
const compare = (a, b) => compareConstructions(a, b, quadroPartCatalog, quadroArticleCatalog);
const kinds = (comparison) => {
  const counts = {};
  for (const c of comparison.changes) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
  return counts;
};

test('a model compared with itself keeps everything', () => {
  const core = load(square);
  const { changes, bill } = compare(core.snapshot, core.snapshot);
  assert.ok(changes.every((c) => c.kind === 'kept'));
  assert.deepEqual(bill, []);
});

test('a post on a corner is new, and that corner connector is swapped for one with more arms', () => {
  const core = load(square);
  const before = core.snapshot;
  const result = core.execute(
    attachTube(
      before,
      { junctionId: 'j1', direction: '+z' },
      { familyId: 'tube-35cm', colour: 'red' },
      quadroPartCatalog,
    ),
  );
  assert.equal(result.ok, true);
  const comparison = compare(before, core.snapshot);
  assert.deepEqual(kinds(comparison), { kept: 7, swapped: 1, added: 1 });
  const swapped = comparison.changes.find((c) => c.kind === 'swapped');
  assert.equal(swapped.before.typeId, 'elbow-connector');
  assert.notEqual(swapped.after.typeId, 'elbow-connector');
  // One more tube and its screws; one elbow less, one other connector more.
  const tubes = comparison.bill.find((d) => d.line.name === 'Rohr 35 cm');
  assert.equal(tubes.difference, 1);
  assert.ok(comparison.bill.some((d) => d.line.name.toLowerCase().includes('kupplung') && d.difference === -1));
  // The other way round the same post is removed.
  assert.deepEqual(kinds(compare(core.snapshot, before)), { kept: 7, swapped: 1, removed: 1 });
});

test('separately built files match by place, not by ID', () => {
  const a = load(square);
  const b = load(square);
  // Remove and re-add a tube in b, so its ID differs, at the same place.
  const t = b.snapshot.design.tubes.find((x) => x.id === 't1');
  assert.equal(b.execute(removeTube(b.snapshot, t.id)).ok, true);
  assert.equal(
    b.execute(
      attachTube(
        b.snapshot,
        { junctionId: 'j1', direction: '+x' },
        { familyId: 'tube-35cm', colour: 'red' },
        quadroPartCatalog,
      ),
    ).ok,
    true,
  );
  assert.ok(!b.snapshot.design.tubes.some((x) => x.id === 't1'));
  assert.ok(compare(a.snapshot, b.snapshot).changes.every((c) => c.kind === 'kept'));
});

test('a moved assembly shows as moved, not as removed and added', () => {
  const core = load([...square, { kind: 'point', name: '160/0/0', at: [160, 0, 0] }, tube('160/0/0', '+x', '200/0/0')]);
  const before = core.snapshot;
  const assembly = assemblyOf(before, 'tube:t5/body');
  assert.equal(
    core.execute(moveAssembly(before, assembly, { translation: { x: 400, y: 0, z: 0 }, quarterTurns: 0 })).ok,
    true,
  );
  const comparison = compare(before, core.snapshot);
  assert.deepEqual(kinds(comparison), { kept: 8, moved: 1 });
  assert.deepEqual(comparison.bill, []);
});
