import type { SlideSpot } from '@qad/model-core';

interface SlideSpotsProps {
  readonly spots: readonly SlideSpot[];
  /** Spot under the pointer and whether hanging the slide there would be valid. */
  readonly hovered: { readonly key: string; readonly valid: boolean } | undefined;
  readonly onHover: (spot: SlideSpot | undefined) => void;
  readonly onPick: (spot: SlideSpot) => void;
}

/** Translucent targets just beyond each tube a slide can hang on, on the side it would run to. */
export function SlideSpots({ spots, hovered, onHover, onPick }: SlideSpotsProps) {
  return (
    <group name="slide-spots">
      {spots.map((spot) => {
        const { position: p, orientation: q } = spot.worldPose;
        const state = hovered?.key === spot.key ? (hovered.valid ? 'valid' : 'invalid') : 'idle';
        const colour = state === 'valid' ? '#1f5fbf' : state === 'invalid' ? '#c62828' : '#8a9099';
        return (
          <group key={spot.key} position={[p.x, p.y, p.z]} quaternion={[q.x, q.y, q.z, q.w]}>
            <mesh
              name={`slide-spot:${spot.key}`}
              position={[200, 0, 60]}
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
              <boxGeometry args={[300, 300, 4]} />
              <meshStandardMaterial color={colour} transparent opacity={state === 'idle' ? 0.25 : 0.5} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
