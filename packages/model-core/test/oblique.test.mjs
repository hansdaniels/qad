import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  DEFAULT_TOLERANCE,
  attachTube,
  createModelCore,
  attachPoints,
  encodeConstruction,
  insertPlate,
  obliqueDirections,
  openConstruction,
  plateSpots,
  quadroCollisionGeometry,
  quadroConnectionEvaluators,
  quadroPartCatalog,
  turnTube,
} from '../src/index.ts';
import { compose, rotate, vec } from '../src/math.ts';

const options = {
  tolerance: DEFAULT_TOLERANCE,
  connectionEvaluators: quadroConnectionEvaluators,
  geometry: quadroCollisionGeometry,
};

function corner() {
  const core = createModelCore(
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
  ).value;
  const result = core.execute(
    attachTube(
      core.snapshot,
      { junctionId: 'j1', direction: '+y' },
      { familyId: 'tube-35cm', colour: 'red' },
      quadroPartCatalog,
    ),
  );
  assert.equal(result.ok, true);
  return core;
}

const oblique = (core, direction, lean) =>
  core.preview(
    attachTube(
      core.snapshot,
      { junctionId: 'j1', direction },
      { familyId: 'tube-35cm', colour: 'blue' },
      quadroPartCatalog,
      { oblique: lean },
    ),
  );

/** Outward direction, in world coordinates, of the connector arm the adapter sleeve sits on. */
function adapterArm(s) {
  const types = new Map(quadroPartCatalog.partTypes.map((t) => [t.id, t]));
  const adapter = s.realization.parts.find((p) => p.origin.role.startsWith('angle-adapter'));
  const isConnector = (id) => s.realization.parts.find((p) => p.id === id)?.origin.role === 'connector';
  const link = s.realization.connections.find(
    (c) =>
      (c.a.partId === adapter.id && isConnector(c.b.partId)) || (c.b.partId === adapter.id && isConnector(c.a.partId)),
  );
  const arm = link.a.partId === adapter.id ? link.b : link.a;
  const connector = s.realization.parts.find((p) => p.id === arm.partId);
  const pose = s.realization.poses.find((p) => p.partId === connector.id).worldPose;
  const site = types.get(connector.typeId).sites.find((x) => x.id === arm.siteId);
  const d = rotate(compose(pose, site.frame).orientation, vec(0, 0, 1));
  return [d.x, d.y, d.z].map((v) => Math.round(v) + 0);
}

test('an oblique tube leans 45° back over the connector from the chosen arm', () => {
  assert.deepEqual(obliqueDirections('+x'), ['+z', '+y', '-y', '-z']);
  const preview = oblique(corner(), '+x', '+z');
  assert.equal(preview.status, 'valid', JSON.stringify(preview.diagnostics));
  assert.deepEqual(adapterArm(preview.candidate), [1, 0, 0]);
  assert.ok(preview.candidate.realization.parts.some((p) => p.typeId === 'diagonal-connector'));
});

test('the same direction from either arm gives two different places', () => {
  // (-x + z)/√2 leaves from arm +x leaning +z, or from arm -z leaning -x.
  const a = oblique(corner(), '+x', '+z');
  const b = oblique(corner(), '-z', '-x');
  assert.equal(a.status, 'valid');
  assert.equal(b.status, 'valid', JSON.stringify(b.diagnostics));
  assert.deepEqual(adapterArm(b.candidate), [0, 0, -1]);
  const far = (s) => s.realization.intentPoses.find((p) => p.intent.id === 'j3').worldPose.position;
  const [pa, pb] = [far(a.candidate), far(b.candidate)];
  assert.ok(Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z) > 10);
});

test('the chosen arm survives saving and opening', () => {
  const core = corner();
  const s = core.execute(
    attachTube(
      core.snapshot,
      { junctionId: 'j1', direction: '-z' },
      { familyId: 'tube-35cm', colour: 'blue' },
      quadroPartCatalog,
      {
        oblique: '-x',
      },
    ),
  );
  assert.equal(s.ok, true);
  const opened = openConstruction(encodeConstruction(s.value), quadroPartCatalog, options);
  assert.equal(opened.ok, true, JSON.stringify(opened.diagnostics));
  assert.equal(opened.value.snapshot.design.tubes[1].a.adapterArm, '-z');
});

test('a straight tube with a free end turns through its oblique positions and back', () => {
  const core = corner();
  const s = core.execute(
    attachTube(
      core.snapshot,
      { junctionId: 'j1', direction: '+x' },
      { familyId: 'tube-35cm', colour: 'blue' },
      quadroPartCatalog,
    ),
  );
  assert.equal(s.ok, true);
  const turns = turnTube(core.snapshot, 't2', quadroPartCatalog);
  // Four oblique positions; the one leaning to +y crosses the first tube.
  const statuses = turns.map((c) => core.preview(c));
  assert.deepEqual(
    statuses.map((p) => p.status),
    ['valid', 'invalid', 'valid', 'valid'],
  );
  assert.equal(statuses[1].diagnostics[0].code, 'crossing');
  const turned = core.execute(turns[0]);
  assert.equal(turned.value.design.tubes[1].a.adapterArm, '+x');
  // From an oblique position the axial one is among the alternatives again, and j2 has gone.
  const back = turnTube(core.snapshot, 't2', quadroPartCatalog).find(
    (c) => !c.operations.some((op) => op.kind === 'set-tube' && op.tube.a.adapterArm),
  );
  assert.equal(core.execute(back).ok, true);
  assert.equal(core.snapshot.design.tubes[1].a.adapterArm, undefined);
  assert.equal(core.snapshot.design.junctions.length, 3);
});

test('a straight tube that carries more at its far end does not turn', () => {
  const core = corner();
  core.execute(
    attachTube(
      core.snapshot,
      { junctionId: 'j2', direction: '+x' },
      { familyId: 'tube-35cm', colour: 'blue' },
      quadroPartCatalog,
    ),
  );
  assert.deepEqual(turnTube(core.snapshot, 't1', quadroPartCatalog), []);
});

/** Executes an attachment and returns the junction at the new tube's far end. */
const attach = (core, junctionId, direction, more = {}) => {
  const result = core.execute(
    attachTube(
      core.snapshot,
      { junctionId, direction },
      { familyId: 'tube-35cm', colour: 'green' },
      quadroPartCatalog,
      more,
    ),
  );
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return core.snapshot.design.tubes.at(-1).b.junctionId;
};
const rounded = (v) => [v.x, v.y, v.z].map((n) => Math.round(n) + 0);

test('the free end of an oblique tube takes a connector tilted with it, so tubes go on straight there', () => {
  const core = corner();
  // On the arm along -x, leaning up: the tube rises towards +x, as a roof from a post.
  const top = attach(core, 'j1', '-x', { oblique: '+z' });
  const arms = attachPoints(core.snapshot, quadroPartCatalog).filter((p) => p.junctionId === top);
  const out = arms.map((p) => rounded(rotate(p.worldPose.orientation, vec(0, 0, 100))));
  // Across the lean the arms stay level; the others turn by 45° with the tube, which takes one of them.
  assert.deepEqual(
    out.sort((a, b) => a.join().localeCompare(b.join())),
    [
      [-71, 0, 71],
      [0, -100, 0],
      [0, 100, 0],
      [71, 0, -71],
      [71, 0, 71],
    ].sort((a, b) => a.join().localeCompare(b.join())),
  );
  for (const p of arms) {
    const preview = core.preview(
      attachTube(core.snapshot, p, { familyId: 'tube-35cm', colour: 'green' }, quadroPartCatalog),
    );
    assert.equal(preview.status, 'valid', p.direction);
  }
  // A ridge: the second slope goes straight down at 45°, without a second angle adapter.
  const down = arms.find((p) => rotate(p.worldPose.orientation, vec(0, 0, 1)).z < -0.5);
  attach(core, top, down.direction);
  const adapters = core.snapshot.realization.parts.filter((p) => p.origin.role.startsWith('angle-adapter'));
  assert.equal(adapters.length, 1);
});

test('a tilted frame closes as a ring, takes a plate and keeps its tilt in the file', () => {
  const core = corner();
  const a = attach(core, 'j1', '-x', { oblique: '+z' });
  const b = attach(core, a, '+y');
  const c = attach(core, b, '+x');
  const d = attach(core, c, '-y');
  attach(core, d, '-x');
  assert.equal(core.snapshot.design.tubes.at(-1).b.junctionId, a);
  const spot = plateSpots(core.snapshot, quadroPartCatalog).find((s) => s.familyId === 'panel-40-40cm');
  const result = core.execute(insertPlate(core.snapshot, spot, 'red'));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  // The plate lies in the roof plane, at 45°.
  assert.ok(Math.abs(Math.abs(rotate(spot.worldPose.orientation, vec(0, 0, 1)).z) - Math.SQRT1_2) < 1e-9);
  const reopened = openConstruction(encodeConstruction(core.snapshot), quadroPartCatalog, options);
  assert.equal(reopened.ok, true);
  assert.deepEqual(reopened.value.snapshot.design.junctions, core.snapshot.design.junctions);
});

test('a ridge joins two roof trusses built mirrored, whose tilted connectors differ by a quarter turn', () => {
  const core = corner();
  // Truss 1 rises from j1 towards +x; truss 2, 40 cm along y, from x = 400 towards -x.
  const apex1 = attach(core, 'j1', '-x', { oblique: '+z' });
  const foot = attach(core, 'j2', '+x');
  const apex2 = attach(core, foot, '+x', { oblique: '+z' });
  const pose = (j) => core.snapshot.realization.intentPoses.find((p) => p.intent.id === j).worldPose;
  assert.deepEqual(rounded(pose(apex2).position), [200, 400, 308]);
  const ridge = attachPoints(core.snapshot, quadroPartCatalog).find(
    (p) => p.junctionId === apex1 && rotate(p.worldPose.orientation, vec(0, 0, 1)).y > 0.9,
  );
  const command = attachTube(core.snapshot, ridge, { familyId: 'tube-35cm', colour: 'green' }, quadroPartCatalog);
  assert.equal(command.operations.find((op) => op.kind === 'add-tube').tube.b.junctionId, apex2);
  const result = core.execute(command);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  // Still only the two angle adapters at the feet.
  assert.equal(core.snapshot.realization.parts.filter((p) => p.origin.role.startsWith('angle-adapter')).length, 2);
});

test('two roof slopes from both eaves meet in one connector at the ridge', () => {
  const core = corner();
  const foot = attach(core, 'j1', '+x');
  const apex = attach(core, 'j1', '-x', { oblique: '+z' });
  const command = attachTube(
    core.snapshot,
    { junctionId: foot, direction: '+x' },
    { familyId: 'tube-35cm', colour: 'green' },
    quadroPartCatalog,
    { oblique: '+z' },
  );
  const added = command.operations.find((op) => op.kind === 'add-tube').tube;
  assert.equal(added.b.junctionId, apex);
  assert.ok(!command.operations.some((op) => op.kind === 'add-junction'));
  const result = core.execute(command);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  // One connector at the ridge with both slopes at right angles; the ridge goes on straight from it.
  const at = (j) =>
    core.snapshot.realization.parts.filter((p) => p.origin.intent.kind === 'junction' && p.origin.intent.id === j);
  assert.deepEqual(
    at(apex).map((p) => p.origin.role),
    ['connector'],
  );
  const ridge = attachPoints(core.snapshot, quadroPartCatalog).find(
    (p) => p.junctionId === apex && rotate(p.worldPose.orientation, vec(0, 0, 1)).y > 0.9,
  );
  attach(core, apex, ridge.direction);
});
