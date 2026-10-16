import { Html } from '@react-three/drei';
import { RotateCw } from 'lucide-react';

interface GhostTurnProps {
  /** In model coordinates, like the ghost it belongs to. */
  readonly position: readonly [number, number, number];
  readonly onTurn: () => void;
}

/** Turns the previewed part to its next position before it is attached. */
export function GhostTurn({ position, onTurn }: GhostTurnProps) {
  return (
    <Html position={[...position]} center zIndexRange={[10, 0]}>
      {/* Html lives inside the canvas' event source; without this a click would clear the preview. */}
      <button
        type="button"
        title="Drehen: nächste Lage (R)"
        aria-label="Vorschau drehen"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onTurn();
        }}
        style={{
          display: 'grid',
          placeItems: 'center',
          width: 34,
          height: 34,
          padding: 0,
          borderRadius: 17,
          border: '1px solid #c8cdd3',
          background: '#fff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
          cursor: 'pointer',
        }}
      >
        <RotateCw size={18} color="#333" aria-hidden />
      </button>
    </Html>
  );
}
