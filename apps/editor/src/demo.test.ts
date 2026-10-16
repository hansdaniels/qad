import { expect, test } from 'vite-plus/test';
import { findOpenEnds, insertPlate, plateSpots, quadroPartCatalog, recolourTube, removeTube } from '@qad/model-core';
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

test('every tube of the demo model can be recoloured and removed without moving the rest', () => {
  for (const tube of demoModel().snapshot.design.tubes) {
    const core = demoModel();
    const before = core.snapshot;
    const recoloured = core.execute(recolourTube(before, tube.id, 'green'));
    expect(recoloured.ok).toBe(true);
    const removed = core.execute(removeTube(core.snapshot, tube.id));
    expect(removed.ok, tube.id).toBe(true);
    if (!removed.ok) continue;
    for (const pose of removed.value.realization.intentPoses) {
      if (pose.intent.kind !== 'junction') continue;
      const was = before.realization.intentPoses.find(
        (p) => p.intent.kind === 'junction' && p.intent.id === pose.intent.id,
      )?.worldPose.position;
      const now = pose.worldPose.position;
      expect(
        was && Math.hypot(was.x - now.x, was.y - now.y, was.z - now.z),
        `${tube.id}/${pose.intent.id}`,
      ).toBeLessThan(0.01);
    }
  }
});

test('a plate fits on top of the demo frame next to its upright tube', () => {
  const core = demoModel();
  const spots = plateSpots(core.snapshot, quadroPartCatalog).filter(
    (s) => s.typeId === 'panel-40-40cm' && s.cellKey.endsWith('00+'),
  );
  expect(spots).toHaveLength(2);
  const previews = spots.map((spot) => core.preview(insertPlate(core.snapshot, spot, 'blue')));
  expect(previews.map((p) => p.status)).toContain('valid');
});
