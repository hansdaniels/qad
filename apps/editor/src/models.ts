import {
  DEFAULT_TOLERANCE,
  createModelCore,
  math,
  quadroCollisionGeometry,
  quadroConnectionEvaluators,
  quadroPartCatalog,
  type ModelCore,
  type ModelCoreOptions,
} from '@qad/model-core';

export const modelOptions: ModelCoreOptions = {
  tolerance: DEFAULT_TOLERANCE,
  connectionEvaluators: quadroConnectionEvaluators,
  geometry: quadroCollisionGeometry,
};

/** An empty model: one anchored junction at the origin to build from. */
export function emptyModel(id = 'modell'): ModelCore {
  const created = createModelCore(
    {
      id,
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
    modelOptions,
  );
  if (!created.ok) throw new Error(created.diagnostics.map((d) => d.message).join('\n'));
  return created.value;
}
