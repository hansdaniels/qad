import { expect, test } from 'vite-plus/test';
import { billOfMaterials, quadroArticleCatalog, quadroPartCatalog } from '@qad/model-core';
import { billCsv } from './BillOfMaterials';
import { demoModel } from './demo';

test('the demo parts list counts every part and exports as CSV', () => {
  const { snapshot } = demoModel();
  const lines = billOfMaterials(snapshot, quadroArticleCatalog, quadroPartCatalog);
  const counted = lines.filter((l) => l.category !== 'fastener').reduce((sum, l) => sum + l.quantity, 0);
  expect(counted).toBe(snapshot.realization.parts.length);
  expect(lines.every((l) => l.articleNumber)).toBe(true);
  const csv = billCsv(lines).split('\r\n');
  expect(csv[0]).toBe('﻿Anzahl;Artikelnummer;Bezeichnung;Farbe');
  expect(csv).toHaveLength(lines.length + 2);
});
