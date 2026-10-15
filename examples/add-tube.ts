import type {
  EditCommand, FamilyId, ModelCore, Pose, Quaternion,
} from '../src/index.js';

/**
 * First straight tube in its own assembly. IDs are allocated by the caller.
 * This is an API example, not a catalog with assumed manufacturer dimensions.
 */
export function previewFirstTube(
  core: ModelCore,
  ids: { readonly tube: string; readonly start: string; readonly end: string; readonly anchor: string },
  familyId: FamilyId,
  worldPose: Pose,
) {
  const forward: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
  const backward: Quaternion = { x: 0, y: 1, z: 0, w: 0 };
  const command: EditCommand = {
    baseRevision: core.snapshot.revision,
    operations: [
      { kind: 'add-junction', junction: { id: ids.start } },
      { kind: 'add-junction', junction: { id: ids.end } },
      {
        kind: 'add-tube',
        tube: {
          id: ids.tube,
          familyId,
          a: { junctionId: ids.start, orientation: forward, roll: { mode: 'free' } },
          b: { junctionId: ids.end, orientation: backward, roll: { mode: 'free' } },
          variant: { mode: 'automatic' },
        },
      },
      {
        kind: 'set-anchor',
        anchor: {
          id: ids.anchor,
          target: { kind: 'junction', id: ids.start },
          worldPose,
        },
      },
    ],
  };
  return core.preview(command);
}
