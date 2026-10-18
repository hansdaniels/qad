import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Outlines } from '@react-three/drei';
import { useMemo } from 'react';
import { ExtrudeGeometry, Path, Quaternion, Shape as Outline, Vector2, Vector3 } from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import type { DisplayShape, Pose, SlabShape } from '@qad/model-core';

const UP = new Vector3(0, 1, 0);

interface Look {
  readonly colour: string;
  readonly selected: boolean;
  /** Preview of a pending edit: translucent and not pickable. */
  readonly ghost?: boolean;
  /** Below 1 the part is see-through, e.g. one that is gone after a rebuild. */
  readonly opacity?: number;
  /** Contour colour marking a change; the part keeps its own colour. */
  readonly outline?: string | undefined;
}

function Material({ colour, selected, ghost, opacity }: Look) {
  const alpha = opacity ?? (ghost ? 0.45 : 1);
  return (
    <meshStandardMaterial
      color={colour}
      emissive={selected ? '#ffb000' : '#000000'}
      emissiveIntensity={selected ? 0.6 : 0}
      transparent={alpha < 1}
      opacity={alpha}
      depthWrite={alpha === 1}
    />
  );
}

/** Contour around a mesh, wide enough to see between neighbouring parts (drei Outlines, in device pixels). */
function Contour({ colour }: { colour: string | undefined }) {
  const dpr = useThree((state) => state.viewport.dpr);
  return colour ? <Outlines thickness={5 * dpr} color={colour} /> : null;
}

/** One display primitive in part coordinates. Capsules are drawn as flat-ended tubes. */
function Shape({ shape, look }: { shape: DisplayShape; look: Look }) {
  switch (shape.kind) {
    case 'capsule': {
      const a = new Vector3(shape.a.x, shape.a.y, shape.a.z);
      const b = new Vector3(shape.b.x, shape.b.y, shape.b.z);
      const axis = b.clone().sub(a);
      const direction = axis.lengthSq() > 0 ? axis.clone().normalize() : UP;
      return (
        <mesh
          position={a.clone().add(b).multiplyScalar(0.5)}
          quaternion={new Quaternion().setFromUnitVectors(UP, direction)}
        >
          <cylinderGeometry args={[shape.radiusMm, shape.radiusMm, axis.length() + 2 * shape.radiusMm, 32]} />
          <Material {...look} />
          <Contour colour={look.outline} />
        </mesh>
      );
    }
    case 'box':
      return (
        <mesh position={[shape.center.x, shape.center.y, shape.center.z]}>
          <boxGeometry args={[2 * shape.halfExtents.x, 2 * shape.halfExtents.y, 2 * shape.halfExtents.z]} />
          <Material {...look} />
          <Contour colour={look.outline} />
        </mesh>
      );
    case 'convex':
      return <ConvexMesh points={shape.points} look={look} />;
    case 'slab':
      return <SlabMesh slab={shape} look={look} />;
  }
}

function SlabMesh({ slab, look }: { slab: SlabShape; look: Look }) {
  const geometry = useMemo(() => {
    const outline = new Outline(slab.outline.map((p) => new Vector2(p.x, p.y)));
    for (const hole of slab.holes) {
      outline.holes.push(new Path().absarc(hole.x, hole.y, hole.radiusMm, 0, 2 * Math.PI, true));
    }
    return new ExtrudeGeometry(outline, { depth: slab.thicknessMm, bevelEnabled: false, curveSegments: 32 });
  }, [slab]);
  return (
    <mesh geometry={geometry} position={[0, 0, slab.bottomZ]}>
      <Material {...look} />
      <Contour colour={look.outline} />
    </mesh>
  );
}

function ConvexMesh({ points, look }: { points: readonly { x: number; y: number; z: number }[]; look: Look }) {
  const geometry = useMemo(() => new ConvexGeometry(points.map((p) => new Vector3(p.x, p.y, p.z))), [points]);
  return (
    <mesh geometry={geometry}>
      <Material {...look} />
      <Contour colour={look.outline} />
    </mesh>
  );
}

interface PartMeshProps extends Look {
  /** Part ID, also the Three.js object name for picking and tests. */
  readonly name: string;
  readonly pose: Pose;
  readonly shapes: readonly DisplayShape[];
  readonly onSelect?: () => void;
  /** Pointer entering (true) or leaving (false) the part. */
  readonly onHover?: (inside: boolean) => void;
}

/** A realised part at its world pose, drawn from its display shapes. */
export function PartMesh({
  name,
  pose,
  shapes,
  colour,
  selected,
  ghost,
  opacity,
  outline,
  onSelect,
  onHover,
}: PartMeshProps) {
  const { position, orientation } = pose;
  return (
    <group
      name={name}
      position={[position.x, position.y, position.z]}
      quaternion={[orientation.x, orientation.y, orientation.z, orientation.w]}
      {...(onHover
        ? { onPointerOver: () => onHover(true), onPointerOut: () => onHover(false) }
        : // A real part hides the targets behind it from the pointer.
          { onPointerOver: (event: ThreeEvent<PointerEvent>) => event.stopPropagation() })}
      onClick={(event) => {
        if (!onSelect) return;
        event.stopPropagation();
        onSelect();
      }}
    >
      {shapes.map((shape, i) => (
        <Shape
          key={i}
          shape={shape}
          look={{
            colour,
            selected,
            outline,
            ...(ghost ? { ghost } : {}),
            ...(opacity === undefined ? {} : { opacity }),
          }}
        />
      ))}
    </group>
  );
}
