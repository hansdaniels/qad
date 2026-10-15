import type { JunctionIntent, PlacementAnchor, PlateIntent, TubeIntent, VariantPolicy } from './design.js';
import type { AnchorId, IntentRef, JunctionId, PlateId, TubeEndRef, TubeId } from './ids.js';

/** Operations in a command are applied in order and validated together atomically. */
export interface EditCommand {
  readonly baseRevision: number;
  readonly operations: readonly DesignOperation[];
}

export type DesignOperation =
  | { readonly kind: 'add-junction'; readonly junction: JunctionIntent }
  | { readonly kind: 'add-tube'; readonly tube: TubeIntent }
  | {
      readonly kind: 'connect-tube-end';
      readonly end: TubeEndRef;
      readonly junctionId: JunctionId;
      // Keeps orientation and roll in the new junction frame. Remove unused junctions explicitly.
    }
  | { readonly kind: 'set-tube'; readonly tube: TubeIntent }
  | { readonly kind: 'add-plate'; readonly plate: PlateIntent }
  | { readonly kind: 'set-plate'; readonly plate: PlateIntent }
  | {
      readonly kind: 'set-variant';
      readonly target:
        | { readonly kind: 'tube'; readonly id: TubeId }
        | { readonly kind: 'plate'; readonly id: PlateId };
      readonly policy: VariantPolicy;
    }
  | { readonly kind: 'set-anchor'; readonly anchor: PlacementAnchor }
  | { readonly kind: 'remove-anchor'; readonly id: AnchorId }
  | {
      readonly kind: 'remove-intent';
      readonly target: IntentRef;
      // No implicit cascading deletion; the same transaction must repair references.
    };
