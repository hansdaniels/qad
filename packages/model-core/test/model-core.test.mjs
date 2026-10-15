import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  DEFAULT_TOLERANCE,
  createModelCore,
  quadroCollisionGeometry,
  quadroConnectionEvaluators,
  quadroPartCatalog,
} from '../src/index.ts';
import { qaxisAngle, vec } from '../src/math.ts';

const options = {
  tolerance: DEFAULT_TOLERANCE,
  connectionEvaluators: quadroConnectionEvaluators,
  geometry: quadroCollisionGeometry,
};
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const at = (x, y, z) => ({ position: vec(x, y, z), orientation: IDENTITY });
const toward = {
  '+x': qaxisAngle(vec(0, 1, 0), Math.PI / 2),
  '-x': qaxisAngle(vec(0, 1, 0), -Math.PI / 2),
  '+y': qaxisAngle(vec(1, 0, 0), -Math.PI / 2),
  '-y': qaxisAngle(vec(1, 0, 0), Math.PI / 2),
  '+z': IDENTITY,
  '-z': qaxisAngle(vec(1, 0, 0), Math.PI),
};
const opposite = { '+x': '-x', '-x': '+x', '+y': '-y', '-y': '+y', '+z': '-z', '-z': '+z' };
const tube = (id, a, b, d, familyId = 'tube-35cm') => ({
  id,
  familyId,
  a: { junctionId: a, orientation: toward[d], roll: { mode: 'free' } },
  b: { junctionId: b, orientation: toward[opposite[d]], roll: { mode: 'free' } },
  variant: { mode: 'automatic' },
  appearance: { colour: 'red' },
});

function start() {
  const created = createModelCore(
    {
      id: 'm',
      catalog: quadroPartCatalog.ref,
      tubes: [],
      junctions: [{ id: 'j1' }],
      plates: [],
      anchors: [{ id: 'anchor', target: { kind: 'junction', id: 'j1' }, worldPose: at(0, 0, 0) }],
    },
    quadroPartCatalog,
    options,
  );
  assert.equal(created.ok, true, JSON.stringify(created.diagnostics));
  return created.value;
}

const run = (core, ...operations) => core.execute({ baseRevision: core.snapshot.revision, operations });
const ok = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.value;
};
const part = (snapshot, intentId, role) =>
  snapshot.realization.parts.find((p) => p.origin.intent.id === intentId && p.origin.role === role);
const junctionAt = (snapshot, id) =>
  snapshot.realization.intentPoses.find((p) => p.intent.id === id).worldPose.position;
const near = (a, b) =>
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);

function square(core) {
  ok(
    run(
      core,
      { kind: 'add-junction', junction: { id: 'j2' } },
      { kind: 'add-tube', tube: tube('t1', 'j1', 'j2', '+x') },
    ),
  );
  ok(
    run(
      core,
      { kind: 'add-junction', junction: { id: 'j3' } },
      { kind: 'add-tube', tube: tube('t2', 'j2', 'j3', '+y') },
    ),
  );
  ok(
    run(
      core,
      { kind: 'add-junction', junction: { id: 'j4' } },
      { kind: 'add-tube', tube: tube('t3', 'j3', 'j4', '-x') },
    ),
  );
  return ok(run(core, { kind: 'add-tube', tube: tube('t4', 'j4', 'j1', '-y') }));
}

test('a square is drawn tube by tube without choosing connectors; closing reuses j1', () => {
  const core = start();
  const first = ok(
    run(
      core,
      { kind: 'add-junction', junction: { id: 'j2' } },
      { kind: 'add-tube', tube: tube('t1', 'j1', 'j2', '+x') },
    ),
  );
  const t1 = part(first, 't1', 'body').id;
  const closed = (() => {
    ok(
      run(
        core,
        { kind: 'add-junction', junction: { id: 'j3' } },
        { kind: 'add-tube', tube: tube('t2', 'j2', 'j3', '+y') },
      ),
    );
    ok(
      run(
        core,
        { kind: 'add-junction', junction: { id: 'j4' } },
        { kind: 'add-tube', tube: tube('t3', 'j3', 'j4', '-x') },
      ),
    );
    return ok(run(core, { kind: 'add-tube', tube: tube('t4', 'j4', 'j1', '-y') }));
  })();
  assert.equal(closed.revision, 4);
  assert.equal(closed.design.junctions.length, 4);
  assert.equal(part(closed, 't1', 'body').id, t1);
  for (const j of ['j1', 'j2', 'j3', 'j4']) assert.equal(part(closed, j, 'connector').typeId, 'elbow-connector');
  near(junctionAt(closed, 'j3'), vec(400, 400, 0));
});

test('another tube at a junction changes its connector but keeps the identities', () => {
  const core = start();
  const closed = square(core);
  const extended = ok(
    run(
      core,
      { kind: 'add-junction', junction: { id: 'j5' } },
      { kind: 'add-tube', tube: tube('t5', 'j1', 'j5', '+z') },
    ),
  );
  assert.equal(part(extended, 'j1', 'connector').id, part(closed, 'j1', 'connector').id);
  assert.equal(part(extended, 'j1', 'connector').typeId, '3way-connector');
  for (const t of ['t1', 't2', 't3', 't4']) assert.equal(part(extended, t, 'body').id, part(closed, t, 'body').id);
});

test('an impossible ring closure is rejected and the valid state stays', () => {
  const core = start();
  ok(
    run(
      core,
      { kind: 'add-junction', junction: { id: 'j2' } },
      { kind: 'add-tube', tube: tube('t1', 'j1', 'j2', '+x') },
    ),
  );
  ok(
    run(
      core,
      { kind: 'add-junction', junction: { id: 'j3' } },
      { kind: 'add-tube', tube: tube('t2', 'j2', 'j3', '+y') },
    ),
  );
  ok(
    run(
      core,
      { kind: 'add-junction', junction: { id: 'j4' } },
      { kind: 'add-tube', tube: tube('t3', 'j3', 'j4', '-x') },
    ),
  );
  const before = core.snapshot;
  const result = run(core, { kind: 'add-tube', tube: tube('t4', 'j4', 'j1', '-y', 'tube-25cm') });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'loop-closure-conflict');
  assert.equal(core.snapshot, before);
});

test('preview does not change the model; a stale revision is refused', () => {
  const core = start();
  const before = core.snapshot;
  const preview = core.preview({
    baseRevision: 0,
    operations: [
      { kind: 'add-junction', junction: { id: 'j2' } },
      { kind: 'add-tube', tube: tube('t1', 'j1', 'j2', '+x') },
    ],
  });
  assert.equal(preview.status, 'valid');
  assert.equal(core.snapshot, before);
  ok(run(core, { kind: 'add-junction', junction: { id: 'j2' } }));
  const stale = core.execute({ baseRevision: 0, operations: [{ kind: 'add-junction', junction: { id: 'j9' } }] });
  assert.equal(stale.diagnostics[0].code, 'stale-revision');
  assert.equal(core.snapshot.revision, 1);
});

test('removing an object others still reference needs the same edit to repair it', () => {
  const core = start();
  ok(
    run(
      core,
      { kind: 'add-junction', junction: { id: 'j2' } },
      { kind: 'add-tube', tube: tube('t1', 'j1', 'j2', '+x') },
    ),
  );
  const dangling = run(core, { kind: 'remove-intent', target: { kind: 'junction', id: 'j2' } });
  assert.equal(dangling.diagnostics[0].code, 'missing-reference');
  const together = ok(
    run(
      core,
      { kind: 'remove-intent', target: { kind: 'tube', id: 't1' } },
      { kind: 'remove-intent', target: { kind: 'junction', id: 'j2' } },
    ),
  );
  assert.equal(together.realization.parts.length, 0);
});

test('moving the anchor moves the assembly and keeps all identities', () => {
  const core = start();
  const closed = square(core);
  const moved = ok(
    run(core, {
      kind: 'set-anchor',
      anchor: { id: 'anchor', target: { kind: 'junction', id: 'j1' }, worldPose: at(1000, 0, 0) },
    }),
  );
  near(junctionAt(moved, 'j3'), vec(1400, 400, 0));
  assert.deepEqual(
    moved.realization.parts.map((p) => p.id),
    closed.realization.parts.map((p) => p.id),
  );
});

test('moving one assembly into another collides; the anchor stays where it was', () => {
  // A tube placed exactly between two frame tubes only touches them; here it overlaps t1.
  const core = start();
  square(core);
  ok(
    run(
      core,
      { kind: 'add-junction', junction: { id: 'k1' } },
      { kind: 'add-junction', junction: { id: 'k2' } },
      { kind: 'add-tube', tube: tube('u1', 'k1', 'k2', '+x') },
      {
        kind: 'set-anchor',
        anchor: { id: 'second', target: { kind: 'junction', id: 'k1' }, worldPose: at(0, 0, 1000) },
      },
    ),
  );
  const before = core.snapshot;
  const into = run(core, {
    kind: 'set-anchor',
    anchor: { id: 'second', target: { kind: 'junction', id: 'k1' }, worldPose: at(100, 0, 0) },
  }); // overlaps t1
  assert.equal(into.ok, false);
  assert.ok(
    into.diagnostics.some((d) => d.code === 'collision' || d.code === 'crossing'),
    JSON.stringify(into.diagnostics),
  );
  assert.equal(core.snapshot, before);
});

test('fixing a drilling variant is reported as a nonstandard variant change', () => {
  const core = start();
  square(core);
  const preview = core.preview({
    baseRevision: core.snapshot.revision,
    operations: [
      {
        kind: 'set-variant',
        target: { kind: 'tube', id: 't1' },
        policy: { mode: 'fixed', typeId: 'tube-35cm-90deg-4hole' },
      },
    ],
  });
  assert.equal(preview.status, 'valid');
  assert.deepEqual(preview.variantChanges, [
    {
      intent: { kind: 'tube', id: 't1' },
      partId: 'tube:t1/body',
      previousTypeId: 'tube-35cm',
      selectedTypeId: 'tube-35cm-90deg-4hole',
      nonstandard: true,
    },
  ]);
});

test('operations on missing objects are refused before solving', () => {
  const core = start();
  const result = run(core, { kind: 'add-tube', tube: tube('t1', 'j1', 'nowhere', '+x') });
  assert.equal(result.diagnostics[0].code, 'missing-reference');
});

test('restoring an earlier state undoes an edit as a new revision; a corrupted state is refused', () => {
  const core = start();
  const before = ok(
    run(
      core,
      { kind: 'add-junction', junction: { id: 'j2' } },
      { kind: 'add-tube', tube: tube('t1', 'j1', 'j2', '+x') },
    ),
  );
  const after = ok(
    run(
      core,
      { kind: 'add-junction', junction: { id: 'j3' } },
      { kind: 'add-tube', tube: tube('t2', 'j2', 'j3', '+y') },
    ),
  );
  const undone = ok(core.restore(before));
  assert.equal(undone.revision, after.revision + 1);
  assert.deepEqual(undone.design, before.design);
  const stale = core.execute({
    baseRevision: after.revision,
    operations: [{ kind: 'add-junction', junction: { id: 'j9' } }],
  });
  assert.equal(stale.diagnostics[0].code, 'stale-revision');
  const redone = ok(core.restore(after));
  assert.deepEqual(redone.realization, after.realization);
  const moved = {
    ...before,
    realization: {
      ...before.realization,
      poses: before.realization.poses.map((p) => ({
        ...p,
        worldPose: { ...p.worldPose, position: { x: 5, y: 5, z: 5 } },
      })),
    },
  };
  assert.equal(core.restore(moved).ok, false);
  assert.equal(core.snapshot.revision, redone.revision);
});
