import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { quadroArticleCatalog, resolveArticle } from '../src/index.ts';

const { colours, entries } = quadroArticleCatalog;

function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

test('entry IDs and article numbers are unique', () => {
  const ids = entries.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  const numbers = entries.flatMap((e) => e.articles.map((a) => a.articleNumber));
  assert.equal(new Set(numbers).size, numbers.length);
  for (const number of numbers) assert.match(number, /^\d{5}$/);
});

test('every entry has articles in distinct catalog colours', () => {
  const colourIds = new Set(colours.map((c) => c.id));
  assert.equal(colourIds.size, colours.length);
  for (const entry of entries) {
    assert.ok(entry.articles.length > 0, entry.id);
    const used = entry.articles.map((a) => a.colour);
    assert.equal(new Set(used).size, used.length, entry.id);
    for (const colour of used) assert.ok(colourIds.has(colour), `${entry.id}: ${colour}`);
  }
});

test('colour mixes are offered for fasteners only', () => {
  const mixes = new Set(colours.filter((c) => c.kind === 'mix').map((c) => c.id));
  for (const entry of entries.filter((e) => e.category !== 'fastener')) {
    for (const article of entry.articles) assert.equal(mixes.has(article.colour), false, entry.id);
  }
});

const resolve = (typeId, colour) => resolveArticle(quadroArticleCatalog, typeId, colour);

test('resolves a requested colour that is offered', () => {
  assert.deepEqual(resolve('tube-35cm', 'pearl-white'), {
    article: { articleNumber: '70082', colour: 'pearl-white' },
    substituted: false,
  });
});

test('tubes default to red, plates to blue and connectors to black', () => {
  assert.deepEqual(resolve('tube-35cm'), {
    article: { articleNumber: '00535', colour: 'red' },
    substituted: false,
  });
  assert.equal(resolve('curved-tube').article.colour, 'red');
  assert.equal(resolve('3way-connector').article.colour, 'black');
  assert.equal(resolve('panel-40-40cm').article.colour, 'blue');
  assert.equal(resolve('wood-grate').article.colour, 'red');
});

test('an unavailable colour falls back to the default instead of failing', () => {
  assert.deepEqual(resolve('tube-35cm-90deg-4hole', 'pearl-white'), {
    article: { articleNumber: '41535', colour: 'red' },
    substituted: true,
  });
});

test('without a usable default the first listed article is used', () => {
  assert.equal(resolve('double-tube-connector').article.colour, 'red');
  assert.equal(resolve('safety-clamp', 'blue').article.colour, 'metallic');
  assert.equal(resolve('unknown'), undefined);
});

test('default colours exist and every tube is offered in red', () => {
  const colourIds = new Set(colours.map((c) => c.id));
  for (const colour of Object.values(quadroArticleCatalog.defaultColours)) {
    assert.ok(colourIds.has(colour), colour);
  }
  for (const tube of entries.filter((e) => e.category === 'tube')) {
    assert.ok(
      tube.articles.some((a) => a.colour === 'red'),
      tube.id,
    );
  }
});

test('a family shares category, shape and nominal length', () => {
  for (const [familyId, members] of groupBy(entries, (e) => e.familyId)) {
    const signature = (e) => JSON.stringify([e.category, e.shape, e.nominalLengthCm]);
    assert.equal(new Set(members.map(signature)).size, 1, familyId);
  }
});

test('every tube family has exactly one standard drilling variant', () => {
  const tubes = entries.filter((e) => e.category === 'tube');
  for (const [familyId, members] of groupBy(tubes, (e) => e.familyId)) {
    const standard = members.filter((e) => e.drilling.kind === 'standard');
    assert.equal(standard.length, 1, familyId);
  }
});

test('initial stage covers the first implementation scope of SPEC 2', () => {
  const initial = entries.filter((e) => e.stage === 'initial');
  const has = (predicate) => initial.some(predicate);
  assert.ok(has((e) => e.category === 'connector' && e.connector === 'planar'));
  assert.ok(has((e) => e.category === 'connector' && e.connector === 'spatial'));
  assert.ok(has((e) => e.category === 'connector' && e.connector === 'angle'));
  assert.ok(has((e) => e.category === 'tube' && e.shape === 'straight'));
  assert.ok(has((e) => e.category === 'tube' && e.shape === 'bent'));
  assert.ok(has((e) => e.category === 'tube' && e.drilling.kind === 'special'));
  assert.ok(has((e) => e.category === 'plate' && e.plate === 'solid'));
});

test('excluded shop products are not listed', () => {
  const excluded = [
    'wood-tube-core',
    'wing-screw',
    'slip-and-slide',
    'multiwheel',
    'caster-v2',
    'panel-set-l',
    'modular-slide',
    'modular-slide-frame',
    'screw-key',
    'integrated-slide',
    'acrylic-glass-integrated-slide',
  ];
  const ids = new Set(entries.map((e) => e.id));
  for (const id of excluded) assert.equal(ids.has(id), false, id);
});

// Rotations mapping axes onto axes: signed permutations with determinant +1.
const axes = ['x', 'y', 'z'];
function axisRotations() {
  const rotations = [];
  for (const perm of [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
    [0, 2, 1],
    [2, 1, 0],
    [1, 0, 2],
  ]) {
    const parity =
      (perm[0] === 0 && perm[1] === 1) || (perm[0] === 1 && perm[1] === 2) || (perm[0] === 2 && perm[1] === 0) ? 1 : -1;
    for (let signs = 0; signs < 8; signs++) {
      const s = [0, 1, 2].map((i) => ((signs >> i) & 1 ? -1 : 1));
      if (parity * s[0] * s[1] * s[2] !== 1) continue;
      rotations.push((direction) => {
        const i = axes.indexOf(direction[1]);
        const sign = (direction[0] === '-' ? -1 : 1) * s[i];
        return `${sign < 0 ? '-' : '+'}${axes[perm[i]]}`;
      });
    }
  }
  return rotations;
}
const rotations = axisRotations();
const byText = (a, b) => a.localeCompare(b);
const canonical = (directions) =>
  rotations.map((rotate) => directions.map(rotate).sort(byText).join(' ')).sort(byText)[0];

test('there are 24 axis rotations', () => {
  assert.equal(rotations.length, 24);
  assert.equal(new Set(rotations.map((r) => ['+x', '+y'].map(r).join())).size, 24);
});

test('arm directions match the arm count of grid connectors', () => {
  const grid = entries.filter((e) => e.armDirections);
  assert.deepEqual(grid.map((e) => e.id).sort(), [
    '3way-connector',
    '4way-connector',
    '5way-connector',
    '6way-connector',
    'cross-connector',
    'elbow-connector',
    'straight-connector',
    't-connector',
  ]);
  for (const e of grid) {
    assert.equal(e.armDirections.length, e.arms, e.id);
    assert.equal(new Set(e.armDirections).size, e.arms, e.id);
  }
});

test('every arrangement of 2 to 6 axis directions has exactly one connector', () => {
  const all = ['+x', '-x', '+y', '-y', '+z', '-z'];
  const byShape = groupBy(
    entries.filter((e) => e.armDirections),
    (e) => canonical(e.armDirections),
  );
  for (let mask = 0; mask < 64; mask++) {
    const directions = all.filter((_, i) => (mask >> i) & 1);
    if (directions.length < 2) continue;
    const matches = byShape.get(canonical(directions)) ?? [];
    assert.equal(matches.length, 1, directions.join(' '));
  }
});

test('a 4-way spatial connector is a planar T with one arm up', () => {
  const shape = (id) => canonical(entries.find((e) => e.id === id).armDirections);
  assert.equal(shape('4way-connector'), canonical(['+x', '-x', '+y', '+z']));
  assert.equal(canonical(['+x', '-x', '+y', '-y']), shape('cross-connector'));
  assert.notEqual(shape('4way-connector'), shape('cross-connector'));
});
