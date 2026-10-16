import { quadroArticleCatalog } from '@qad/model-core';
import { expect, test } from 'vite-plus/test';
import { inAssortment } from './assortment';

test('the common assortment keeps the usual tubes and plates and hides the rare ones', () => {
  const families = new Set(quadroArticleCatalog.entries.map((e) => e.familyId));
  const common = (id: string) => {
    expect(families.has(id), id).toBe(true);
    return inAssortment(id, 'common');
  };
  for (const id of ['tube-15cm', 'tube-35cm', 'tube-75cm', 'curved-tube', 'panel-40-40cm', 'panel-40-20cm'])
    expect(common(id), id).toBe(true);
  for (const id of ['tube-10cm', 'tube-20cm', 'tube-25cm', 'tube-52cm', 'panel-30-30cm', 'hole-panel-40-40cm'])
    expect(common(id), id).toBe(false);
  expect(inAssortment('tube-52cm', 'all')).toBe(true);
});
