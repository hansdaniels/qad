import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useLayoutEffect, useState } from 'react';
import { Box3, Vector3 } from 'three';

interface SelectionTrashProps {
  /** Name of the selected part's object in the scene. */
  readonly partId: string;
  /** Changes whenever the scene may have moved, e.g. the snapshot revision. */
  readonly revision: number;
  readonly onDelete: () => void;
}

/** A delete button floating above the selected part. */
export function SelectionTrash({ partId, revision, onDelete }: SelectionTrashProps) {
  const scene = useThree((state) => state.scene);
  const [anchor, setAnchor] = useState<[number, number, number] | undefined>();
  useLayoutEffect(() => {
    const object = scene.getObjectByName(partId);
    if (!object) {
      setAnchor(undefined);
      return;
    }
    object.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(object);
    const centre = box.getCenter(new Vector3());
    setAnchor([centre.x, box.max.y + 60, centre.z]);
  }, [scene, partId, revision]);
  if (!anchor) return null;
  return (
    <Html position={anchor} center zIndexRange={[10, 0]}>
      <button
        type="button"
        title="Löschen (Entf)"
        aria-label="Löschen"
        onClick={onDelete}
        style={{
          display: 'grid',
          placeItems: 'center',
          width: 34,
          height: 34,
          borderRadius: 17,
          border: '1px solid #c8cdd3',
          background: '#fff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
          cursor: 'pointer',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#b00020" strokeWidth="2" aria-hidden="true">
          <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
        </svg>
      </button>
    </Html>
  );
}
