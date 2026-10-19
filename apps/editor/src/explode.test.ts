import { describe, expect, test } from 'vite-plus/test';
import { quadroDisplayGeometry, quadroPartCatalog, type DisplayShape } from '@qad/model-core';
import { explodedOf } from './explode';

const exploded = (id: string) => {
  const type = quadroPartCatalog.partTypes.find((t) => t.id === id)!;
  return explodedOf(type, quadroDisplayGeometry.shapes(type.geometry.display) ?? []);
};
const pipes = (shapes: readonly DisplayShape[]) => shapes.flatMap((s) => (s.kind === 'pipe' ? [s] : []));

describe('exploded view', () => {
  test('a straight tube becomes a thin rod ending 70 mm short of each connector, more than an arm reaches in', () => {
    const [rod, ...more] = pipes(exploded('tube-35cm')!.shapes);
    expect(more).toHaveLength(0);
    expect([rod!.a.x, rod!.b.x]).toEqual([70, 280]);
    expect(rod!.radiusMm).toBeLessThan(10);
  });

  test('a short tube keeps 40 % of its length', () => {
    const [rod] = pipes(exploded('tube-10cm')!.shapes);
    expect(rod!.b.x - rod!.a.x).toBeCloseTo(40);
  });

  test('a connector shows a small core and every arm as a short rod from its middle, drawn white with black lines', () => {
    const type = quadroPartCatalog.partTypes.find((t) => t.kind === 'connector' && t.sites.length === 6)!;
    const shapes = explodedOf(type, quadroDisplayGeometry.shapes(type.geometry.display) ?? [])!.shapes;
    const arms = pipes(shapes);
    expect(arms).toHaveLength(6);
    for (const arm of arms) {
      expect(arm.a).toEqual({ x: 0, y: 0, z: 0 });
      expect(Math.hypot(arm.b.x, arm.b.y, arm.b.z)).toBeCloseTo(55);
    }
    expect(explodedOf(type, [])!.drawing).toEqual({ colour: '#ffffff', outline: '#1d1d1d', lineMm: 3 });
  });

  test('a plate shrinks in its plane only; slides stay as they are', () => {
    expect(exploded('panel-40-40cm')!.shrink!.scale).toEqual([0.7, 0.7, 1]);
    expect(exploded('slide-runout')).toBeUndefined();
  });
});
