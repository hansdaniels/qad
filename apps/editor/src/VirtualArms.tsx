import { useState } from 'react';
import type { AttachPoint } from '@qad/model-core';

interface VirtualArmsProps {
  readonly points: readonly AttachPoint[];
  readonly pending: AttachPoint | undefined;
  readonly onPick: (point: AttachPoint) => void;
}

const key = (p: AttachPoint) => `${p.junctionId}:${p.direction}`;

/** Free directions as translucent stubs from the arm shoulder outwards (model coordinates). */
export function VirtualArms({ points, pending, onPick }: VirtualArmsProps) {
  const [hovered, setHovered] = useState<string | undefined>();
  return (
    <group name="virtual-arms">
      {points.map((point) => {
        const { position: p, orientation: q } = point.worldPose;
        const id = key(point);
        const active = id === hovered || (pending && id === key(pending));
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
                setHovered(id);
              }}
              onPointerOut={() => setHovered((h) => (h === id ? undefined : h))}
            >
              <cylinderGeometry args={[16, 16, 50, 20]} />
              <meshStandardMaterial color={active ? '#1f5fbf' : '#8a9099'} transparent opacity={active ? 0.85 : 0.45} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
