import { expect, test } from 'vite-plus/test';
import { attachPoints, encodeConstruction, quadroPartCatalog } from '@qad/model-core';
import { demoModel } from './demo';
import { emptyModel } from './models';
import { modelFileName, modelTitle, openModel } from './storage';

test('the demo model comes back from its file unchanged', () => {
  const saved = demoModel().snapshot;
  const opened = openModel(encodeConstruction(saved));
  expect(opened.ok).toBe(true);
  if (opened.ok) expect(opened.value.snapshot).toEqual(JSON.parse(encodeConstruction(saved)).snapshot);
});

test('a new model offers its start point to build from', () => {
  expect(attachPoints(emptyModel().snapshot, quadroPartCatalog)).toHaveLength(6);
});

test('a named model is saved under its name; without a name it keeps the file it came from', () => {
  expect(modelFileName('Garten: Turm/Rutsche  2', 'alt.json')).toBe('Garten- Turm-Rutsche 2.json');
  expect(modelFileName(undefined, 'alt.json')).toBe('alt.json');
  expect(modelTitle(undefined, 'alt.json')).toBe('alt');
  expect(modelTitle('Garten', 'alt.json')).toBe('Garten');
});
