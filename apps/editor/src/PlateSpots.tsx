import { quadroPartCatalog, type PlateSpot } from '@qad/model-core';

const CELLS = new Map(quadroPartCatalog.partTypes.flatMap((t) => (t.kind === 'plate' ? [[t.id, t.cellMm]] : [])));

interface PlateSpotsProps {
  /** One spot per cell side; its frame places the target. */
  readonly spots: readonly PlateSpot[];
  /** Cell side under the pointer and whether inserting there would be valid. */
  readonly hovered: { readonly cellKey: string; readonly valid: boolean } | undefined;
  readonly onHover: (spot: PlateSpot | undefined) => void;
  readonly onPick: (spot: PlateSpot) => void;
}

/**
 * Translucent targets just above each free cell side, in model coordinates. The
 * side facing the camera is hit first, so a plate goes where one looks from.
 */
export function PlateSpots({ spots, hovered, onHover, onPick }: PlateSpotsProps) {
  return (
    <group name="plate-spots">
      {spots.map((spot) => {
        const [x, y] = CELLS.get(spot.typeId) ?? [0, 0];
        const { position: p, orientation: q } = spot.worldPose;
        const state = hovered?.cellKey === spot.cellKey ? (hovered.valid ? 'valid' : 'invalid') : 'idle';
        const colour = state === 'valid' ? '#1f5fbf' : state === 'invalid' ? '#c62828' : '#8a9099';
        return (
          <group key={spot.cellKey} position={[p.x, p.y, p.z]} quaternion={[q.x, q.y, q.z, q.w]}>
            <mesh
              name={`spot:${spot.cellKey}`}
              position={[0, 0, 45]}
              onClick={(event) => {
                event.stopPropagation();
                onPick(spot);
              }}
              onPointerOver={(event) => {
                event.stopPropagation();
                onHover(spot);
              }}
              onPointerOut={() => onHover(undefined)}
            >
              <boxGeometry args={[x - 80, y - 80, 4]} />
              <meshStandardMaterial color={colour} transparent opacity={state === 'idle' ? 0.25 : 0.5} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
