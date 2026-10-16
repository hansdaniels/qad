import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { ConstructionDocumentSchema, parseConstructionDocument } from '../src/index.ts';

function document() {
  const pose = {
    position: { x: 0, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  };
  return {
    format: 'qad-construction',
    schemaVersion: 1,
    snapshot: {
      revision: 0,
      design: {
        id: 'construction-1',
        catalog: { id: 'synthetic', version: '1' },
        tubes: [
          {
            id: 'tube-1',
            familyId: 'straight',
            a: { junctionId: 'j1', orientation: pose.orientation, roll: { mode: 'free' } },
            b: {
              junctionId: 'j2',
              orientation: { x: 0, y: 1, z: 0, w: 0 },
              roll: { mode: 'fixed', radians: 0 },
            },
            variant: { mode: 'automatic', preferredTypeId: 'tube-type' },
            appearance: { colour: 'red' },
          },
        ],
        junctions: [{ id: 'j1' }, { id: 'j2' }],
        plates: [
          {
            id: 'plate-1',
            familyId: 'plate',
            variant: { mode: 'fixed', typeId: 'plate-type' },
            placement: { junctionId: 'j1', pose },
            mounts: [
              {
                plateSiteId: 'mount',
                tubeId: 'tube-1',
                stationMm: 100,
                hole: { mode: 'fixed', tubeTypeId: 'tube-type', siteId: 'hole' },
              },
            ],
          },
        ],
        slides: [{ id: 's1', familyId: 'slide', tubeId: 'tube-1', toward: '+x', appearance: { colour: 'red' } }],
        anchors: [{ id: 'anchor', target: { kind: 'junction', id: 'j1' }, worldPose: pose }],
      },
      realization: {
        parts: [
          {
            id: 'physical-tube',
            typeId: 'tube-type',
            origin: { intent: { kind: 'tube', id: 'tube-1' }, role: 'body' },
          },
        ],
        connections: [
          {
            id: 'connection',
            a: { partId: 'physical-tube', siteId: 'hole' },
            b: { partId: 'physical-plate', siteId: 'mount' },
            typeId: 'plate-mount',
            parameters: { rotation: 0 },
          },
        ],
        plateMounts: [
          {
            plateId: 'plate-1',
            plateSiteId: 'mount',
            tubeId: 'tube-1',
            tubeHole: { partId: 'physical-tube', siteId: 'hole' },
            connectionId: 'connection',
          },
        ],
        poses: [{ partId: 'physical-tube', worldPose: pose }],
        intentPoses: [{ intent: { kind: 'junction', id: 'j1' }, worldPose: pose }],
      },
    },
  };
}

test('reads the complete wire shape without changing values or materialising optional fields', () => {
  const input = document();
  input.snapshot.design.plates[0].appearance = { colour: 'dark-grey' };
  const result = parseConstructionDocument(JSON.stringify(input));
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, input);
  assert.equal('preferredRad' in result.value.snapshot.design.tubes[0].a.roll, false);
});

test('fills in default colours: red for tubes, blue for plates', () => {
  const input = document();
  delete input.snapshot.design.tubes[0].appearance;
  const result = parseConstructionDocument(JSON.stringify(input));
  assert.equal(result.ok, true);
  const { tubes, plates } = result.value.snapshot.design;
  assert.deepEqual(tubes[0].appearance, { colour: 'red' });
  assert.deepEqual(plates[0].appearance, { colour: 'blue' });
});

test('reads files from before slides as having none', () => {
  const input = document();
  delete input.snapshot.design.slides;
  const result = parseConstructionDocument(JSON.stringify(input));
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.snapshot.design.slides, []);
});

test('reports JSON syntax errors without throwing', () => {
  const result = parseConstructionDocument('{');
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'invalid-data');
});

test('recognises an unsupported version before applying the version 1 shape', () => {
  const result = parseConstructionDocument(
    JSON.stringify({
      format: 'qad-construction',
      schemaVersion: 2,
      futurePayload: {},
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'unsupported-schema');
});

const corruptions = [
  [
    'wrong format',
    (d) => {
      d.format = 'other';
    },
  ],
  [
    'missing revision',
    (d) => {
      delete d.snapshot.revision;
    },
  ],
  [
    'fractional revision',
    (d) => {
      d.snapshot.revision = 0.5;
    },
  ],
  [
    'negative revision',
    (d) => {
      d.snapshot.revision = -1;
    },
  ],
  [
    'unknown root field',
    (d) => {
      d.extra = true;
    },
  ],
  [
    'unknown nested field',
    (d) => {
      d.snapshot.design.tubes[0].extra = true;
    },
  ],
  [
    'empty ID',
    (d) => {
      d.snapshot.design.id = '';
    },
  ],
  [
    'string instead of number',
    (d) => {
      d.snapshot.revision = '0';
    },
  ],
  [
    'invalid union tag',
    (d) => {
      d.snapshot.design.tubes[0].variant.mode = 'guess';
    },
  ],
  [
    'missing fixed variant',
    (d) => {
      delete d.snapshot.design.plates[0].variant.typeId;
    },
  ],
  [
    'negative mount station',
    (d) => {
      d.snapshot.design.plates[0].mounts[0].stationMm = -1;
    },
  ],
  [
    'missing quaternion component',
    (d) => {
      delete d.snapshot.design.tubes[0].a.orientation.w;
    },
  ],
  [
    'empty colour',
    (d) => {
      d.snapshot.design.tubes[0].appearance.colour = '';
    },
  ],
  [
    'null appearance',
    (d) => {
      d.snapshot.design.tubes[0].appearance = null;
    },
  ],
];
for (const [name, corrupt] of corruptions) {
  test(`rejects ${String(name)}`, () => {
    const input = document();
    corrupt(input);
    const result = parseConstructionDocument(JSON.stringify(input));
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, 'invalid-data');
    assert.equal(typeof result.diagnostics[0].details.path, 'string');
  });
}

test('rejects nonfinite numbers, including an overflowing JSON exponent', () => {
  const json = JSON.stringify(document()).replace('"stationMm":100', '"stationMm":1e999');
  const result = parseConstructionDocument(json);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].details.path, '/snapshot/design/plates/0/mounts/0/stationMm');
  for (const value of [NaN, Infinity, -Infinity]) {
    const input = document();
    input.snapshot.realization.connections[0].parameters.rotation = value;
    assert.equal(ConstructionDocumentSchema.safeParse(input).success, false);
  }
});

test('format success does not claim referential integrity or buildability', () => {
  const input = document();
  input.snapshot.design.tubes[0].a.junctionId = 'missing-junction';
  assert.equal(parseConstructionDocument(JSON.stringify(input)).ok, true);
});
