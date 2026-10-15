import { math, type DesignOperation, type ModelCore, type Quaternion, type TubeIntent } from '@qad/model-core';
import { emptyModel } from './models';

const { qaxisAngle, vec } = math;
const IDENTITY: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

/** Rotation taking +Z onto an axis direction. */
const TOWARD = {
  '+x': qaxisAngle(vec(0, 1, 0), Math.PI / 2),
  '-x': qaxisAngle(vec(0, 1, 0), -Math.PI / 2),
  '+y': qaxisAngle(vec(1, 0, 0), -Math.PI / 2),
  '-y': qaxisAngle(vec(1, 0, 0), Math.PI / 2),
  '+z': IDENTITY,
  '-z': qaxisAngle(vec(1, 0, 0), Math.PI),
} as const;
type Direction = keyof typeof TOWARD;
const OPPOSITE: Record<Direction, Direction> = {
  '+x': '-x',
  '-x': '+x',
  '+y': '-y',
  '-y': '+y',
  '+z': '-z',
  '-z': '+z',
};

function tube(
  id: string,
  a: string,
  b: string,
  aEnd: Quaternion,
  bEnd: Quaternion,
  colour: string,
  familyId = 'tube-35cm',
): TubeIntent {
  return {
    id,
    familyId,
    a: { junctionId: a, orientation: aEnd, roll: { mode: 'free' } },
    b: { junctionId: b, orientation: bEnd, roll: { mode: 'free' } },
    variant: { mode: 'automatic' },
    appearance: { colour },
  };
}

function straight(id: string, a: string, b: string, d: Direction, colour: string, familyId?: string): DesignOperation {
  return { kind: 'add-tube', tube: tube(id, a, b, TOWARD[d], TOWARD[OPPOSITE[d]], colour, familyId) };
}

const junction = (id: string): DesignOperation => ({ kind: 'add-junction', junction: { id } });

/** A frame with a post and an oblique tube, built through ModelCore commands. */
export function demoModel(): ModelCore {
  const core = emptyModel('demo');
  const steps: DesignOperation[][] = [
    [junction('j2'), straight('t1', 'j1', 'j2', '+x', 'red')],
    [junction('j3'), straight('t2', 'j2', 'j3', '+y', 'blue')],
    [junction('j4'), straight('t3', 'j3', 'j4', '-x', 'yellow')],
    [straight('t4', 'j4', 'j1', '-y', 'green')],
    [junction('j5'), straight('t5', 'j3', 'j5', '+z', 'red')],
    // 45° up and outwards from j2, carried by an angle connector on the free -z arm.
    [
      junction('j6'),
      {
        kind: 'add-tube',
        tube: tube(
          't6',
          'j2',
          'j6',
          qaxisAngle(vec(0, 1, 0), Math.PI / 4),
          qaxisAngle(vec(0, 1, 0), (5 * Math.PI) / 4),
          'blue',
        ),
      },
    ],
  ];
  for (const operations of steps) {
    const result = core.execute({ baseRevision: core.snapshot.revision, operations });
    if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join('\n'));
  }
  return core;
}
