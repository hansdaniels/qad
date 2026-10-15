import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { findOpenEnds } from '../src/index.ts';

const identity = { x: 0, y: 0, z: 0, w: 1 };

function tube(id, a, b) {
  const endpoint = (junctionId) => ({ junctionId, orientation: identity, roll: { mode: 'free' } });
  return {
    id, familyId: 'tube-35cm', a: endpoint(a), b: endpoint(b),
    variant: { mode: 'automatic' }, appearance: { colour: 'red' },
  };
}

function design(tubes) {
  const ids = [...new Set(tubes.flatMap((t) => [t.a.junctionId, t.b.junctionId]))];
  return {
    id: 'c', catalog: { id: 'synthetic', version: '1' }, tubes,
    junctions: ids.map((id) => ({ id })), plates: [], anchors: [],
  };
}

test('a single tube has two open ends', () => {
  assert.deepEqual(findOpenEnds(design([tube('t1', 'j1', 'j2')])), [
    { tubeId: 't1', end: 'a', junctionId: 'j1' },
    { tubeId: 't1', end: 'b', junctionId: 'j2' },
  ]);
});

test('a shared junction closes both tube ends there', () => {
  const open = findOpenEnds(design([tube('t2', 'j2', 'j3'), tube('t1', 'j1', 'j2')]));
  assert.deepEqual(open, [
    { tubeId: 't1', end: 'a', junctionId: 'j1' },
    { tubeId: 't2', end: 'b', junctionId: 'j3' },
  ]);
});

test('a closed square frame has no open ends', () => {
  const frame = design([
    tube('t1', 'j1', 'j2'), tube('t2', 'j2', 'j3'), tube('t3', 'j3', 'j4'), tube('t4', 'j4', 'j1'),
  ]);
  assert.deepEqual(findOpenEnds(frame), []);
});

test('an empty design and unused junctions yield nothing', () => {
  const empty = design([]);
  assert.deepEqual(findOpenEnds({ ...empty, junctions: [{ id: 'lonely' }] }), []);
});
