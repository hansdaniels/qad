import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Outlines } from '@react-three/drei';
import { useMemo } from 'react';
import {
  BufferGeometry,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  FrontSide,
  LatheGeometry,
  Path,
  Quaternion,
  Shape as Outline,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import { NURBSSurface } from 'three/examples/jsm/curves/NURBSSurface.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { ParametricGeometry } from 'three/examples/jsm/geometries/ParametricGeometry.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DisplayShape, FoldShape, MarkShape, NurbsShape, PipeShape, Pose, SlabShape } from '@qad/model-core';
import type { Shrink } from './explode';

const UP = new Vector3(0, 1, 0);
/** Bend marks: a signal colour no part comes in, drawn thick. */
const FOLD = { colour: '#e6007e', radiusMm: 4 };

interface Look {
  readonly colour: string;
  readonly selected: boolean;
  /** Preview of a pending edit: translucent and not pickable. */
  readonly ghost?: boolean;
  /** Below 1 the part is see-through, e.g. one that is gone after a rebuild. */
  readonly opacity?: number;
  /** Contour colour marking a change; the part keeps its own colour. */
  readonly outline?: string | undefined;
  /** Contour thickness on the part in mm, thinner as one zooms out; otherwise fixed on screen. */
  readonly outlineMm?: number | undefined;
}

function Material({ colour, selected, ghost, opacity, twoSided }: Look & { twoSided?: boolean }) {
  const alpha = opacity ?? (ghost ? 0.45 : 1);
  return (
    <meshStandardMaterial
      side={twoSided ? DoubleSide : FrontSide}
      color={colour}
      emissive={selected ? '#ffb000' : '#000000'}
      emissiveIntensity={selected ? 0.6 : 0}
      transparent={alpha < 1}
      opacity={alpha}
      depthWrite={alpha === 1}
    />
  );
}

/**
 * Contour around a mesh (drei Outlines): by default wide enough on screen to see
 * between neighbouring parts, in device pixels; with mm, that thick on the part.
 * Outlines takes screenspace to mean the latter.
 */
function Contour({ colour, mm }: { colour: string | undefined; mm?: number | undefined }) {
  const dpr = useThree((state) => state.viewport.dpr);
  if (!colour) return null;
  return mm ? <Outlines screenspace thickness={mm} color={colour} /> : <Outlines thickness={5 * dpr} color={colour} />;
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
          <Contour colour={look.outline} mm={look.outlineMm} />
        </mesh>
      );
    }
    case 'box':
      return (
        <mesh position={[shape.center.x, shape.center.y, shape.center.z]}>
          <boxGeometry args={[2 * shape.halfExtents.x, 2 * shape.halfExtents.y, 2 * shape.halfExtents.z]} />
          <Material {...look} />
          <Contour colour={look.outline} mm={look.outlineMm} />
        </mesh>
      );
    case 'convex':
      return <ConvexMesh points={shape.points} look={look} />;
    case 'slab':
      return <SlabMesh slab={shape} look={look} />;
    case 'pipe':
      return <PipeMesh pipe={shape} look={look} />;
    case 'nurbs':
      return <NurbsMesh surface={shape} look={look} />;
    case 'fold':
      return <FoldMesh fold={shape} ghost={look.ghost ?? false} />;
    case 'mark':
      return <MarkMesh mark={shape} look={look} />;
    case 'arc':
      return (
        <mesh position={[shape.center.x, shape.center.y, shape.center.z]} rotation={[0, 0, shape.startRad]}>
          <torusGeometry args={[shape.radiusMm, shape.tubeRadiusMm, 24, 32, shape.endRad - shape.startRad]} />
          <Material {...look} />
          <Contour colour={look.outline} mm={look.outlineMm} />
        </mesh>
      );
  }
}

/** Straight tube along a to b, turned from its profile; hollow ones show their bore at the ends. */
function PipeMesh({ pipe, look }: { pipe: PipeShape; look: Look }) {
  const a = new Vector3(pipe.a.x, pipe.a.y, pipe.a.z);
  const axis = new Vector3(pipe.b.x, pipe.b.y, pipe.b.z).sub(a);
  const length = axis.length();
  const geometry = useMemo(() => {
    const [r, inner] = [pipe.radiusMm, pipe.innerRadiusMm];
    const profile = (
      inner > 0
        ? [
            [inner, 0],
            [r, 0],
            [r, length],
            [inner, length],
            [inner, 0],
          ]
        : [
            [0, 0],
            [r, 0],
            [r, length],
            [0, length],
          ]
    ).map(([x, y]) => new Vector2(x, y));
    return new LatheGeometry(profile, 32);
  }, [pipe.radiusMm, pipe.innerRadiusMm, length]);
  const direction = length > 0 ? axis.clone().normalize() : UP;
  return (
    <mesh geometry={geometry} position={a} quaternion={new Quaternion().setFromUnitVectors(UP, direction)}>
      <Material {...look} twoSided={pipe.innerRadiusMm > 0} />
      <Contour colour={look.outline} mm={look.outlineMm} />
    </mesh>
  );
}

/** Bend mark as a rod along the edge, half standing out of the plate face. */
function FoldMesh({ fold, ghost }: { fold: FoldShape; ghost: boolean }) {
  const a = new Vector3(fold.a.x, fold.a.y, fold.a.z);
  const axis = new Vector3(fold.b.x, fold.b.y, fold.b.z).sub(a);
  return (
    <mesh
      position={a.clone().addScaledVector(axis, 0.5)}
      quaternion={new Quaternion().setFromUnitVectors(UP, axis.clone().normalize())}
    >
      <cylinderGeometry args={[FOLD.radiusMm, FOLD.radiusMm, axis.length(), 16]} />
      <meshBasicMaterial color={FOLD.colour} transparent={ghost} opacity={ghost ? 0.45 : 1} />
    </mesh>
  );
}

/** Marks stand out dark on light parts and light on dark ones. */
const MARK = { radiusMm: 4, dark: '#1d1d1d', light: '#f2f2f2' };

/** A marked line as a thin rod half sunk into the face, so it never flickers against it. */
function MarkMesh({ mark, look }: { mark: MarkShape; look: Look }) {
  const a = new Vector3(mark.a.x, mark.a.y, mark.a.z);
  const axis = new Vector3(mark.b.x, mark.b.y, mark.b.z).sub(a);
  const hsl = new Color(look.colour).getHSL({ h: 0, s: 0, l: 0 });
  return (
    <mesh
      position={a.clone().addScaledVector(axis, 0.5)}
      quaternion={new Quaternion().setFromUnitVectors(UP, axis.clone().normalize())}
    >
      <cylinderGeometry args={[MARK.radiusMm, MARK.radiusMm, axis.length(), 12]} />
      <Material {...look} colour={hsl.l > 0.45 ? MARK.dark : MARK.light} />
    </mesh>
  );
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
      <Contour colour={look.outline} mm={look.outlineMm} />
    </mesh>
  );
}

/**
 * Moulded surface, e.g. a slide, drawn from its NURBS by three's NURBSSurface.
 * The catalog hands out the same surface for every part of a type, so they share
 * one geometry.
 */
const surfaces = new WeakMap<object, BufferGeometry>();
function surfaceGeometry(surface: NurbsShape): BufferGeometry {
  let geometry = surfaces.get(surface);
  if (!geometry) {
    const nurbs = new NURBSSurface(
      surface.degreeU,
      surface.degreeV,
      [...surface.knotsU],
      [...surface.knotsV],
      surface.points.map((row) => row.map((p) => new Vector4(p.x, p.y, p.z, p.w))),
    );
    geometry = new ParametricGeometry((u, v, target) => nurbs.getPoint(u, v, target), 64, 32);
    surfaces.set(surface, geometry);
  }
  return geometry;
}

function NurbsMesh({ surface, look }: { surface: NurbsShape; look: Look }) {
  const geometry = useMemo(() => surfaceGeometry(surface), [surface]);
  return (
    <mesh geometry={geometry}>
      <Material {...look} twoSided />
      <Contour colour={look.outline} mm={look.outlineMm} />
    </mesh>
  );
}

/**
 * Hulls by their points: the catalog hands out the same points for every part of
 * a type, so all connectors of one kind share one geometry.
 */
const hulls = new WeakMap<object, BufferGeometry>();
function hull(points: readonly { x: number; y: number; z: number }[]): BufferGeometry {
  let geometry = hulls.get(points);
  if (!geometry) {
    // Smooth across the facets of a curved hull, sharp at real edges such as a tube's rim.
    geometry = toCreasedNormals(new ConvexGeometry(points.map((p) => new Vector3(p.x, p.y, p.z))), Math.PI / 6);
    hulls.set(points, geometry);
  }
  return geometry;
}

function ConvexMesh({ points, look }: { points: readonly { x: number; y: number; z: number }[]; look: Look }) {
  const geometry = useMemo(() => hull(points), [points]);
  return (
    <mesh geometry={geometry}>
      <Material {...look} />
      <Contour colour={look.outline} mm={look.outlineMm} />
    </mesh>
  );
}

interface PartMeshProps extends Look {
  /** Part ID, also the Three.js object name for picking and tests. */
  readonly name: string;
  readonly pose: Pose;
  readonly shapes: readonly DisplayShape[];
  /** Exploded view: the part's own shapes scaled about a point in its frame. */
  readonly shrink?: Shrink | undefined;
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
  outlineMm,
  shrink,
  onSelect,
  onHover,
}: PartMeshProps) {
  const { position, orientation } = pose;
  const look = {
    colour,
    selected,
    outline,
    outlineMm,
    ...(ghost ? { ghost } : {}),
    ...(opacity === undefined ? {} : { opacity }),
  };
  const own = shapes.map((shape, i) => <Shape key={i} shape={shape} look={look} />);
  const o = shrink?.origin;
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
      {shrink && o ? (
        <group position={[o.x, o.y, o.z]} scale={[...shrink.scale]}>
          <group position={[-o.x, -o.y, -o.z]}>{own}</group>
        </group>
      ) : (
        own
      )}
    </group>
  );
}
