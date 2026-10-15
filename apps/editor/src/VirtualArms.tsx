import type { AttachPoint } from '@qad/model-core';

export const armKey = (p: AttachPoint) => `${p.junctionId}:${p.direction}`;

interface VirtualArmsProps {
  readonly points: readonly AttachPoint[];
  /** Key of the arm under the pointer and whether attaching there would be valid. */
  readonly hovered: { readonly key: string; readonly valid: boolean } | undefined;
  readonly onHover: (point: AttachPoint | undefined) => void;
  readonly onPick: (point: AttachPoint) => void;
}

/** Free directions as translucent stubs from the arm shoulder outwards (model coordinates). */
export function VirtualArms({ points, hovered, onHover, onPick }: VirtualArmsProps) {
  return (
    <group name="virtual-arms">
      {points.map((point) => {
        const { position: p, orientation: q } = point.worldPose;
        const id = armKey(point);
        const state = hovered?.key === id ? (hovered.valid ? 'valid' : 'invalid') : 'idle';
        const colour = state === 'valid' ? '#1f5fbf' : state === 'invalid' ? '#c62828' : '#8a9099';
        return (
          <group key={id} name={`arm:${id}`} position={[p.x, p.y, p.z]} quaternion={[q.x, q.y, q.z, q.w]}>
            {/* Cylinders run along y; turn them onto the arm's +Z and start at the shoulder. */}
            <mesh
              position={[0, 0, 25]}
              rotation={[Math.PI / 2, 0, 0]}
              onClick={(event) => {
                event.stopPropagation();
                onPick(point);
              }}
              onPointerOver={(event) => {
                event.stopPropagation();
                onHover(point);
              }}
              onPointerOut={() => onHover(undefined)}
            >
              <cylinderGeometry args={[16, 16, 50, 20]} />
              <meshStandardMaterial color={colour} transparent opacity={state === 'idle' ? 0.45 : 0.85} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
