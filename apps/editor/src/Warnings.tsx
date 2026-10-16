import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { HeadTrap, PartId } from '@qad/model-core';

interface WarningsProps {
  readonly traps: readonly HeadTrap[];
  readonly onHighlight: (partIds: readonly PartId[]) => void;
  readonly onPick: (partId: PartId) => void;
}

const centimetres = (mm: number) => `${Math.round(mm / 10)} cm`;
const metres = (mm: number) => `${(mm / 1000).toLocaleString('de-DE', { maximumFractionDigits: 2 })} m`;

/** Warning sign with a count; the list opens on top of the sidebar instead of taking room in it. */
export function Warnings({ traps, onHighlight, onPick }: WarningsProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  if (traps.length === 0) return null;
  const label = `${traps.length} mögliche Kopffalle${traps.length > 1 ? 'n' : ''}`;
  return (
    <span ref={root} style={{ position: 'relative' }}>
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          padding: '1px 5px',
          border: '1px solid #e0b84a',
          borderRadius: 4,
          background: open ? '#ffe9b0' : '#fff6e0',
          color: '#6b4a00',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        <TriangleAlert size={15} aria-hidden />
        {traps.length}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={label}
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 30,
            width: 250,
            padding: 8,
            borderRadius: 4,
            background: '#fff6e0',
            color: '#6b4a00',
            fontSize: 14,
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          }}
        >
          <p style={{ margin: '0 0 4px' }}>Mögliche Kopffallen (Regel des Herstellers):</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {traps.map((trap) => (
              <li
                key={trap.tubes.join('|')}
                onMouseEnter={() => onHighlight(trap.partIds)}
                onMouseLeave={() => onHighlight([])}
                onClick={() => onPick(trap.partIds[0])}
                style={{ cursor: 'pointer' }}
              >
                {centimetres(trap.clearWidthMm)} lichte Weite, bis {metres(trap.heightMm)} hoch
              </li>
            ))}
          </ul>
          <p style={{ margin: '4px 0 0' }}>Eine Platte an beiden Rohren schließt die Öffnung.</p>
        </div>
      ) : null}
    </span>
  );
}
