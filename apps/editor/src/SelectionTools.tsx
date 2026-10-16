import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { Paintbrush, RotateCw, Trash2 } from 'lucide-react';
import { useLayoutEffect, useState, type CSSProperties } from 'react';
import { Box3, Vector3 } from 'three';
import type { ColourId } from '@qad/model-core';
import { displayColour, type ColourOption } from './colours';

interface SelectionToolsProps {
  /** Name of the selected part's object in the scene. */
  readonly partId: string;
  /** Changes whenever the scene may have moved, e.g. the snapshot revision. */
  readonly revision: number;
  /** Colours to choose from; none when the part takes no colour of its own. */
  readonly colours: readonly ColourOption[];
  readonly colour: ColourId | undefined;
  readonly onRecolour: (colour: ColourId) => void;
  readonly onDelete: () => void;
  /** Puts the part into its next buildable position; only for parts that have one. */
  readonly onTurn?: (() => void) | undefined;
}

const BUTTON = 34;
const SWATCH = 28;

const round = (size: number): CSSProperties => ({
  display: 'grid',
  placeItems: 'center',
  width: size,
  height: size,
  padding: 0,
  borderRadius: size / 2,
  cursor: 'pointer',
  boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
});

/** Brush and trash floating above the selected part; the brush opens a ring of colours. */
export function SelectionTools({
  partId,
  revision,
  colours,
  colour,
  onRecolour,
  onDelete,
  onTurn,
}: SelectionToolsProps) {
  const scene = useThree((state) => state.scene);
  const [anchor, setAnchor] = useState<[number, number, number] | undefined>();
  const [open, setOpen] = useState(false);
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
  // Swatches sit on a circle around the brush, just apart from each other.
  const radius = Math.max(BUTTON, (colours.length * (SWATCH + 8)) / (2 * Math.PI));
  return (
    <Html position={anchor} center zIndexRange={[10, 0]}>
      {/* Html lives inside the canvas' event source; without this a click would deselect the part. */}
      <div
        style={{ display: 'flex', gap: 8 }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {colours.length > 0 ? (
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              title="Farbe"
              aria-label="Farbe"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
              style={{
                ...round(BUTTON),
                border: `3px solid ${displayColour(colour)}`,
                background: open ? '#e8edf3' : '#fff',
              }}
            >
              <Paintbrush size={18} color="#333" aria-hidden />
            </button>
            {open
              ? colours.map((c, i) => {
                  const angle = (2 * Math.PI * i) / colours.length - Math.PI / 2;
                  const current = c.id === colour;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      title={c.name}
                      aria-label={c.name}
                      aria-pressed={current}
                      onClick={() => {
                        setOpen(false);
                        if (!current) onRecolour(c.id);
                      }}
                      style={{
                        ...round(SWATCH),
                        position: 'absolute',
                        left: BUTTON / 2 + radius * Math.cos(angle) - SWATCH / 2,
                        top: BUTTON / 2 + radius * Math.sin(angle) - SWATCH / 2,
                        background: displayColour(c.id),
                        border: current ? '3px solid #111' : '2px solid #fff',
                      }}
                    />
                  );
                })
              : null}
          </div>
        ) : null}
        {onTurn ? (
          <button
            type="button"
            title="Drehen: nächste Lage (R)"
            aria-label="Drehen"
            onClick={onTurn}
            style={{ ...round(BUTTON), border: '1px solid #c8cdd3', background: '#fff' }}
          >
            <RotateCw size={18} color="#333" aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          title="Löschen (Entf)"
          aria-label="Löschen"
          onClick={onDelete}
          style={{ ...round(BUTTON), border: '1px solid #c8cdd3', background: '#fff' }}
        >
          <Trash2 size={18} color="#b00020" aria-hidden />
        </button>
      </div>
    </Html>
  );
}
