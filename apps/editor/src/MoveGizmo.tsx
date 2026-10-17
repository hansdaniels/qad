import { Html, TransformControls } from '@react-three/drei';
import { useRef, type ComponentRef, type RefObject } from 'react';
import type { Group, Object3D, Vector3 as ThreeVector3 } from 'three';
import type { Vector3 } from '@qad/model-core';

interface MoveGizmoProps {
  /** Point the assembly turns about, in model coordinates on the floor. */
  readonly pivot: Vector3;
  /** Current, snapped translation in model coordinates. */
  readonly translation: Vector3;
  /** Shown beside the handle, e.g. which tube fits. */
  readonly label?: string | undefined;
  readonly invalid: boolean;
  /** Raw translation while dragging; the caller snaps it. */
  readonly onDrag: (raw: Vector3) => void;
  readonly onDragEnd: () => void;
  /** A click on an arrow without dragging: one stop along that model axis. */
  readonly onStep: (axis: 'x' | 'y' | 'z', sign: 1 | -1) => void;
  /** The handle was used; a click on it must not count as a click beside the model. */
  readonly onUse: () => void;
}

type Controls = ComponentRef<typeof TransformControls>;
/** Handle movement up to which a press still counts as a click on the arrow. */
const CLICK_MM = 30;

/**
 * Handle with three arrows for moving an assembly, along the floor and upwards.
 * It lives in the Three.js world: y up is the model's z, model y runs along -z.
 */
export function MoveGizmo({ pivot, translation, label, invalid, onDrag, onDragEnd, onStep, onUse }: MoveGizmoProps) {
  const handle = useRef<Group>(null);
  const controls = useRef<Controls>(null);
  // Farthest the handle got from where it was pressed; a little jitter is still a click.
  const reach = useRef(0);
  const pressed = useRef<ThreeVector3 | undefined>(undefined);
  const at: [number, number, number] = [pivot.x + translation.x, pivot.z + translation.z, -(pivot.y + translation.y)];
  return (
    <>
      <group ref={handle} position={at} />
      <TransformControls
        ref={controls}
        object={handle as RefObject<Object3D>}
        mode="translate"
        size={0.9}
        onMouseDown={() => {
          onUse();
          reach.current = 0;
          pressed.current = handle.current?.position.clone();
        }}
        onMouseUp={() => {
          onUse();
          // axis and pointStart are public at runtime, only private in the typings.
          const c = controls.current as unknown as { axis: string | null; pointStart: ThreeVector3 } | null;
          if (reach.current > CLICK_MM || !c) return onDragEnd();
          // Which half of the arrow was hit tells the direction: pointStart is the hit
          // point relative to the handle, in the Three.js world.
          const axis = c.axis;
          const along =
            axis === 'X' ? c.pointStart.x : axis === 'Y' ? c.pointStart.y : axis === 'Z' ? c.pointStart.z : 0;
          if (along === 0) return;
          const sign = along > 0 ? 1 : -1;
          if (axis === 'X') onStep('x', sign);
          else if (axis === 'Y') onStep('z', sign);
          else onStep('y', sign === 1 ? -1 : 1);
        }}
        onObjectChange={() => {
          const p = handle.current?.position;
          if (!p) return;
          const raw = { x: p.x - pivot.x, y: -p.z - pivot.y, z: p.y - pivot.z };
          if (pressed.current) reach.current = Math.max(reach.current, p.distanceTo(pressed.current));
          onDrag(raw);
        }}
      />
      {label || invalid ? (
        <Html position={[at[0], at[1] + 350, at[2]]} center zIndexRange={[10, 0]}>
          <div
            style={{
              padding: '2px 8px',
              borderRadius: 4,
              whiteSpace: 'nowrap',
              fontSize: 13,
              background: invalid ? '#fdecea' : '#e8f0fb',
              color: invalid ? '#8a1c1c' : '#1f3f73',
              boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
              pointerEvents: 'none',
            }}
          >
            {invalid ? 'Hier nicht baubar' : label}
          </div>
        </Html>
      ) : null}
    </>
  );
}
