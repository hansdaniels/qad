import { expect, test } from 'vite-plus/test';
import { findOpenEnds, recolourTube, removeTube } from '@qad/model-core';
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
