import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  DEFAULT_TOLERANCE,
  attachTube,
  constructionCodec,
  createModelCore,
  encodeConstruction,
  openConstruction,
  quadroCollisionGeometry,
  quadroConnectionEvaluators,
  quadroPartCatalog,
  renameModel,
} from '../src/index.ts';
import { vec } from '../src/math.ts';

const options = {
  tolerance: DEFAULT_TOLERANCE,
  connectionEvaluators: quadroConnectionEvaluators,
  geometry: quadroCollisionGeometry,
};

function lone() {
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
  assert.equal(created.ok, true);
  return created.value;
}

function frame() {
  const core = lone();
  for (const [junctionId, direction] of [
    ['j1', '+x'],
    ['j2', '+y'],
    ['j3', '-x'],
    ['j4', '-y'],
  ]) {
    const command = attachTube(
      core.snapshot,
      { junctionId, direction },
      { familyId: 'tube-35cm', colour: 'green' },
      quadroPartCatalog,
    );
    assert.equal(core.execute(command).ok, true);
  }
  return core;
}

test('a saved model opens with the same design and realization', () => {
  const saved = frame().snapshot;
  const opened = openConstruction(encodeConstruction(saved), quadroPartCatalog, options);
  assert.equal(opened.ok, true, JSON.stringify(opened.diagnostics));
  assert.deepEqual(opened.value.snapshot, JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(
    constructionCodec.decode(encodeConstruction(saved), quadroPartCatalog, options).value,
    opened.value.snapshot,
  );
});

test('a model keeps its name in the file; a blank name takes it away', () => {
  const core = frame();
  assert.equal(core.execute(renameModel(core.snapshot, '  Garten mit Dach ')).ok, true);
  assert.equal(core.snapshot.design.name, 'Garten mit Dach');
  assert.equal(renameModel(core.snapshot, 'Garten mit Dach').operations.length, 0);
  const opened = openConstruction(encodeConstruction(core.snapshot), quadroPartCatalog, options);
  assert.equal(opened.value.snapshot.design.name, 'Garten mit Dach');
  assert.equal(core.execute(renameModel(core.snapshot, ' ')).ok, true);
  assert.equal('name' in core.snapshot.design, false);
});

test('an opened model can be edited further', () => {
  const opened = openConstruction(encodeConstruction(frame().snapshot), quadroPartCatalog, options).value;
  const command = attachTube(
    opened.snapshot,
    { junctionId: 'j1', direction: '+z' },
    { familyId: 'tube-35cm', colour: 'red' },
    quadroPartCatalog,
  );
  assert.equal(opened.execute(command).ok, true);
});

test('a file from before the ids were renamed opens with the current ids', () => {
  const saved = frame().snapshot;
  const old = encodeConstruction(saved).replaceAll('"gbk-', '"quadro-');
  assert.match(old, /"quadro-provisional"/);
  assert.match(old, /"quadro-arm-tube"/);
  const opened = openConstruction(old, quadroPartCatalog, options);
  assert.equal(opened.ok, true, JSON.stringify(opened.diagnostics));
  assert.deepEqual(opened.value.snapshot, JSON.parse(JSON.stringify(saved)));
});

test('a stored realization that does not fit its design is rejected', () => {
  const document = JSON.parse(encodeConstruction(frame().snapshot));
  document.snapshot.realization.poses[0].worldPose.position.z += 40;
  const opened = openConstruction(JSON.stringify(document), quadroPartCatalog, options);
  assert.equal(opened.ok, false);
});

test('foreign, broken and future files are refused with a reason', () => {
  const codes = (json) => openConstruction(json, quadroPartCatalog, options).diagnostics.map((d) => d.code);
  assert.deepEqual(codes('kein json'), ['invalid-data']);
  const document = JSON.parse(encodeConstruction(frame().snapshot));
  assert.deepEqual(codes(JSON.stringify({ ...document, schemaVersion: 2 })), ['unsupported-schema']);
  document.snapshot.design.catalog.version = 'other';
  assert.ok(codes(JSON.stringify(document)).includes('catalog-mismatch'));
});
