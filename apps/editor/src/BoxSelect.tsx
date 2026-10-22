import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Vector3 } from 'three';
import { SelectionBox } from 'three/examples/jsm/interactive/SelectionBox.js';

interface BoxSelectProps {
  /** Whether an object name is that of a pickable part. */
  readonly isPart: (name: string) => boolean;
  /** The parts whose middle lies inside the rectangle, also those hidden behind others. */
  readonly onPick: (names: readonly string[]) => void;
}

/** Below this many pixels a Shift drag still counts as a Shift click. */
const DRAG_PX = 5;

/**
 * Shift and drag draws a rectangle over the model and picks the parts inside;
 * the camera stays put meanwhile, and the click ending the drag picks nothing else.
 */
export function BoxSelect({ isPart, onPick }: BoxSelectProps) {
  const { camera, scene, gl, controls } = useThree();
  const latest = useRef({ isPart, onPick });
  latest.current = { isPart, onPick };
  useEffect(() => {
    const element = gl.domElement;
    const frame = document.createElement('div');
    Object.assign(frame.style, {
      position: 'fixed',
      pointerEvents: 'none',
      border: '1px solid #1f5fbf',
      background: 'rgba(31, 95, 191, 0.1)',
      zIndex: '30',
    });
    const camerasControls = controls as { enabled: boolean } | null;
    let start: { x: number; y: number } | undefined;
    let dragged = false;
    let swallowClick = false;
    const toDevice = (x: number, y: number) => {
      const r = element.getBoundingClientRect();
      return new Vector3(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1, 0.5);
    };
    const end = () => {
      start = undefined;
      frame.remove();
      if (camerasControls) camerasControls.enabled = true;
    };
    const down = (event: PointerEvent) => {
      if (!event.shiftKey || event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY };
      dragged = false;
      // Captured before the camera controls see the press, so Shift and drag does not pan.
      if (camerasControls) camerasControls.enabled = false;
    };
    const move = (event: PointerEvent) => {
      if (!start) return;
      if (!dragged && Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_PX) return;
      if (!dragged) document.body.appendChild(frame);
      dragged = true;
      Object.assign(frame.style, {
        left: `${Math.min(start.x, event.clientX)}px`,
        top: `${Math.min(start.y, event.clientY)}px`,
        width: `${Math.abs(event.clientX - start.x)}px`,
        height: `${Math.abs(event.clientY - start.y)}px`,
      });
    };
    const up = (event: PointerEvent) => {
      if (!start) return;
      if (dragged) {
        const box = new SelectionBox(camera, scene);
        const names = new Set<string>();
        for (const mesh of box.select(toDevice(start.x, start.y), toDevice(event.clientX, event.clientY))) {
          let object: typeof mesh.parent = mesh;
          while (object && !latest.current.isPart(object.name)) object = object.parent;
          if (object) names.add(object.name);
        }
        latest.current.onPick([...names]);
        swallowClick = true;
      }
      end();
    };
    const click = (event: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.stopPropagation();
    };
    element.addEventListener('pointerdown', down, { capture: true });
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('click', click, { capture: true });
    return () => {
      end();
      element.removeEventListener('pointerdown', down, { capture: true });
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('click', click, { capture: true });
    };
  }, [camera, scene, gl, controls]);
  return null;
}
