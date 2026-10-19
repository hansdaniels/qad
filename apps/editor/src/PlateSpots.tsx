import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { Mesh, Quaternion, Vector3 } from 'three';
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
 * Translucent targets just above each free cell side, in model coordinates.
 * Only the side facing the camera shows and takes the pointer, so a plate goes
 * where one looks from and the two sides of a cell never stack up.
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
            <Target
              spot={spot}
              size={[x - 80, y - 80]}
              colour={colour}
              opacity={state === 'idle' ? 0.25 : 0.5}
              onHover={onHover}
              onPick={onPick}
            />
          </group>
        );
      })}
    </group>
  );
}

const HIDDEN_LAYER = 31;
const [at, normal, towards, turn] = [new Vector3(), new Vector3(), new Vector3(), new Quaternion()];

interface TargetProps extends Pick<PlateSpotsProps, 'onHover' | 'onPick'> {
  readonly spot: PlateSpot;
  readonly size: readonly [number, number];
  readonly colour: string;
  readonly opacity: number;
}

/** One target, shown and pickable only while its side faces the camera. */
function Target({ spot, size, colour, opacity, onHover, onPick }: TargetProps) {
  const mesh = useRef<Mesh>(null);
  useFrame(({ camera }) => {
    const m = mesh.current;
    if (!m) return;
    m.getWorldPosition(at);
    normal.set(0, 0, 1).applyQuaternion(m.getWorldQuaternion(turn));
    const facing = normal.dot(towards.copy(camera.position).sub(at)) > 0;
    // Off layer 0, neither the camera draws it nor the pointer's raycaster hits it.
    m.layers.set(facing ? 0 : HIDDEN_LAYER);
  });
  return (
    <mesh
      ref={mesh}
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
      <boxGeometry args={[size[0], size[1], 4]} />
      <meshStandardMaterial color={colour} transparent opacity={opacity} />
    </mesh>
  );
}
