import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vite-plus/test';
import {
  DEFAULT_TOLERANCE,
  checkBuildability,
  copyParts,
  createModelCore,
  encodeFragment,
  importPlan,
  isFragment,
  math,
  parseFragment,
  pasteFragment,
  quadroArticleCatalog,
  quadroCollisionGeometry,
  quadroConnectionEvaluators,
  quadroPartCatalog,
  removeParts,
} from '../src/index.ts';

const options = {
  tolerance: DEFAULT_TOLERANCE,
  connectionEvaluators: quadroConnectionEvaluators,
  geometry: quadroCollisionGeometry,
};
const examples = [
  ...readFileSync(new URL('../../../BAUPLAN.md', import.meta.url), 'utf8').matchAll(/```json\n([\s\S]*?)```/g),
].map((m) => m[1]);
const build = (example) => {
  const built = importPlan(example, quadroPartCatalog, quadroArticleCatalog, options);
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
  return built.value;
};
const empty = () =>
  createModelCore(
    {
      id: 'leer',
      catalog: quadroPartCatalog.ref,
      tubes: [],
      junctions: [{ id: 'j1' }],
      plates: [],
      slides: [],
      anchors: [
        {
          id: 'anchor',
          target: { kind: 'junction', id: 'j1' },
          worldPose: { position: math.vec(0, 0, 0), orientation: { x: 0, y: 0, z: 0, w: 1 } },
        },
      ],
    },
    quadroPartCatalog,
    options,
  ).value;
const allParts = (core) => core.snapshot.realization.parts.map((p) => p.id);
const junctionPositions = (snapshot) =>
  snapshot.realization.intentPoses.flatMap((p) => (p.intent.kind === 'junction' ? [p.worldPose.position] : []));
const buildable = (snapshot) =>
  checkBuildability(snapshot, quadroPartCatalog, quadroCollisionGeometry, {
    ...options,
    minClearanceMm: 0,
    maxRemediesPerFinding: 0,
  }).verdict;
/** Through the clipboard's text, as from another tab. */
const viaText = (fragment) => {
  const text = encodeFragment(fragment);
  assert.ok(isFragment(text));
  const parsed = parseFragment(text, quadroPartCatalog);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.diagnostics));
  return parsed.value;
};

test('a whole model pasted into itself stands beside it on the floor as a second, unconnected assembly', () => {
  const core = build(examples[0]);
  const before = core.snapshot;
  const fragment = viaText(copyParts(before, quadroPartCatalog, allParts(core)));
  const pasted = core.execute(pasteFragment(before, quadroPartCatalog, fragment));
  assert.equal(pasted.ok, true, JSON.stringify(pasted.diagnostics));
  const after = pasted.value;
  assert.equal(after.realization.parts.length, 2 * before.realization.parts.length);
  assert.equal(after.design.anchors.length, 2 * before.design.anchors.length);
  assert.equal(after.design.plates.length, 2 * before.design.plates.length);
  const right = Math.max(...junctionPositions(before).map((p) => p.x));
  const fresh = junctionPositions(after).filter((p) => p.x > right);
  assert.equal(fresh.length, junctionPositions(before).length);
  assert.equal(Math.round(Math.min(...fresh.map((p) => p.x)) - right), 800);
  assert.equal(Math.round(Math.min(...fresh.map((p) => p.z))), 0);
  assert.equal(buildable(after), 'buildable');
});

test('pasted into an empty model, the copy replaces the start point and stands where it stood', () => {
  const tower = build(examples[1]);
  const fragment = viaText(copyParts(tower.snapshot, quadroPartCatalog, allParts(tower)));
  const target = empty();
  const pasted = target.execute(pasteFragment(target.snapshot, quadroPartCatalog, fragment));
  assert.equal(pasted.ok, true, JSON.stringify(pasted.diagnostics));
  assert.equal(pasted.value.realization.parts.length, tower.snapshot.realization.parts.length);
  assert.equal(pasted.value.design.slides.length, 2);
  assert.deepEqual(
    junctionPositions(pasted.value)
      .map((p) => [p.x, p.y, p.z].map(Math.round))
      .sort(),
    junctionPositions(tower.snapshot)
      .map((p) => [p.x, p.y, p.z].map(Math.round))
      .sort(),
  );
});

test('a plate brings its flange tubes, a slide body the tubes it hangs and rests on', () => {
  const tower = build(examples[1]);
  const { snapshot } = tower;
  const partOf = (kind, id) =>
    snapshot.realization.parts.find((p) => p.origin.intent.kind === kind && p.origin.intent.id === id).id;
  const plate = copyParts(snapshot, quadroPartCatalog, [partOf('plate', snapshot.design.plates[0].id)]);
  assert.equal(plate.design.plates.length, 1);
  assert.equal(plate.design.tubes.length, 2);
  const body = snapshot.design.slides.find((s) => s.familyId === 'modular-slide-body');
  const slide = copyParts(snapshot, quadroPartCatalog, [partOf('slide', body.id)]);
  assert.equal(slide.design.slides.length, 1);
  assert.equal(slide.design.tubes.length, 2);
  // Two lone tubes, each its own assembly with its own anchor; the body still rests on the lower one.
  assert.equal(slide.design.anchors.length, 2);
  const target = empty();
  const pasted = target.execute(pasteFragment(target.snapshot, quadroPartCatalog, viaText(slide)));
  assert.equal(pasted.ok, true, JSON.stringify(pasted.diagnostics));
  // Connectors alone stand for nothing to copy.
  const connector = snapshot.realization.parts.find((p) => p.origin.intent.kind === 'junction').id;
  assert.equal(copyParts(snapshot, quadroPartCatalog, [connector]), undefined);
});

test('copied parts from another catalog or broken text are refused', () => {
  const core = build(examples[0]);
  const fragment = copyParts(core.snapshot, quadroPartCatalog, allParts(core));
  const foreign = JSON.parse(encodeFragment(fragment));
  foreign.design.catalog.version = 'other';
  assert.deepEqual(
    parseFragment(JSON.stringify(foreign), quadroPartCatalog).diagnostics.map((d) => d.code),
    ['catalog-mismatch'],
  );
  assert.equal(isFragment('kein json'), false);
  assert.equal(isFragment('{"format":"qad-construction"}'), false);
  assert.equal(parseFragment('{"format":"qad-fragment"}', quadroPartCatalog).ok, false);
});

test('removing several parts at once takes plates and slides on removed tubes and re-anchors what falls apart', () => {
  const tower = build(examples[1]);
  const { snapshot } = tower;
  // The four lowest posts: the ground frame falls away from the rest of the tower.
  const lowPosts = snapshot.realization.parts
    .filter((p) => p.origin.intent.kind === 'tube')
    .filter((p) => {
      const pose = snapshot.realization.poses.find((q) => q.partId === p.id).worldPose;
      const axis = math.rotate(pose.orientation, math.vec(1, 0, 0));
      return Math.abs(axis.z) > 0.99 && pose.position.z < 200 && pose.position.x < 500;
    })
    .map((p) => p.id);
  assert.equal(lowPosts.length, 4);
  const removed = tower.execute(removeParts(snapshot, lowPosts));
  assert.equal(removed.ok, true, JSON.stringify(removed.diagnostics));
  assert.equal(removed.value.design.tubes.length, snapshot.design.tubes.length - 4);
  assert.equal(removed.value.design.anchors.length, 2);
  assert.equal(removed.value.design.slides.length, 2);
});
