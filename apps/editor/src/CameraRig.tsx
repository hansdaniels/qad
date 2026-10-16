import { CameraControls, CameraControlsImpl, OrthographicCamera } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Box3, Sphere, Vector3, type Camera } from 'three';
import { builtBox } from './ModelScene';

export type ViewId = 'perspective' | 'top' | 'front' | 'side';

export const VIEWS: readonly { readonly id: ViewId; readonly name: string; readonly title: string }[] = [
  { id: 'perspective', name: '3D', title: 'Frei drehbare Ansicht' },
  { id: 'top', name: 'Oben', title: 'Draufsicht' },
  { id: 'front', name: 'Vorn', title: 'Vorderansicht' },
  { id: 'side', name: 'Seite', title: 'Seitenansicht von rechts' },
];

interface CameraRigProps {
  readonly view: ViewId;
  /** Counts requests to fit the model into the current view. */
  readonly fit: number;
}

/** Far enough that no model reaches behind an orthographic camera. */
const DISTANCE = 20000;
/** Where an orthographic camera looks from, in Three.js world (y up, model -y towards the front). */
const FROM: Record<Exclude<ViewId, 'perspective'>, [number, number, number]> = {
  top: [0, DISTANCE, 0],
  front: [0, 0, DISTANCE],
  side: [DISTANCE, 0, 0],
};
const PADDING = { paddingTop: 150, paddingBottom: 150, paddingLeft: 150, paddingRight: 150 };
/** Shown around the start point while the model is still empty. */
const EMPTY = new Box3(new Vector3(-200, -200, -200), new Vector3(200, 200, 200));

const isOrthographic = (camera: Camera) => 'isOrthographicCamera' in camera;

function modelBox(scene: Parameters<typeof builtBox>[0]) {
  const box = builtBox(scene);
  return box.isEmpty() ? EMPTY : box;
}

/**
 * Camera and navigation: a perspective camera that orbits freely, or an
 * orthographic one looking straight from the top, front or side. These only pan
 * and zoom. Coming back to 3D restores the last free view.
 */
export function CameraRig({ view, fit }: CameraRigProps) {
  const controls = useRef<CameraControlsImpl>(null);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const free = useRef({ position: new Vector3(1300, 900, 900), target: new Vector3(200, 100, -200) });
  const ortho = view !== 'perspective';

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    if (isOrthographic(camera) !== ortho) {
      // The camera is about to change; remember the free view while it is still current.
      if (!isOrthographic(camera)) {
        c.getPosition(free.current.position);
        c.getTarget(free.current.target);
      }
      return;
    }
    if (view === 'perspective') {
      const { position: p, target: t } = free.current;
      void c.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, false);
      return;
    }
    c.azimuthRotateSpeed = 0;
    c.polarRotateSpeed = 0;
    c.mouseButtons.left = CameraControlsImpl.ACTION.TRUCK;
    c.touches.one = CameraControlsImpl.ACTION.TOUCH_TRUCK;
    const box = modelBox(scene);
    const centre = box.getCenter(new Vector3());
    const [x, y, z] = FROM[view];
    void c.setLookAt(centre.x + x, centre.y + y, centre.z + z, centre.x, centre.y, centre.z, false);
    void c.fitToBox(box, false, PADDING);
  }, [view, camera, ortho, scene]);

  useEffect(() => {
    const c = controls.current;
    if (!c || fit === 0) return;
    const box = modelBox(scene);
    // fitToBox would also turn a free view onto the nearest axis.
    if (isOrthographic(c.camera)) void c.fitToBox(box, true, PADDING);
    else void c.fitToSphere(box.getBoundingSphere(new Sphere()), true);
  }, [fit, scene]);

  return (
    <>
      {ortho ? <OrthographicCamera makeDefault near={1} far={5 * DISTANCE} /> : null}
      <CameraControls ref={controls} makeDefault dollyToCursor />
    </>
  );
}
