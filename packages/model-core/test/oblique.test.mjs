import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  DEFAULT_TOLERANCE,
  attachTube,
  createModelCore,
  encodeConstruction,
  obliqueDirections,
  openConstruction,
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
