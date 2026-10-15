import { expect, test } from 'vite-plus/test';
import { findOpenEnds } from '@qad/model-core';
import { demoModel } from './demo';

test('the demo model is built through ModelCore commands and is buildable', () => {
  const { snapshot } = demoModel();
  expect(snapshot.revision).toBe(6);
  expect(snapshot.realization.parts.some((p) => p.typeId === 'diagonal-connector')).toBe(true);
  expect(
    snapshot.realization.parts.find((p) => p.origin.intent.id === 'j3' && p.origin.role === 'connector')?.typeId,
  ).toBe('3way-connector');
  expect(findOpenEnds(snapshot.design)).toHaveLength(2);
});
