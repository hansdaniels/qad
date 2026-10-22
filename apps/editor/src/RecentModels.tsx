import { X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { forgetSlot, heldSlots, recentSlots, type SlotInfo } from './slots';

interface RecentModelsProps {
  /** This tab's slot, left out of the list. */
  readonly current: string;
  readonly onOpen: (id: string) => void;
}

const WHEN = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' });

/** Models of other and earlier tabs, last changed first; one open in another tab cannot be opened here too. */
export function RecentModels({ current, onOpen }: RecentModelsProps) {
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<readonly SlotInfo[]>([]);
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  const refresh = useCallback(() => {
    setSlots(recentSlots().filter((s) => s.id !== current));
    void heldSlots().then(setHeld);
  }, [current]);
  // Other tabs store as they go; the open list follows them.
  useEffect(() => {
    if (!open) return;
    refresh();
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [open, refresh]);
  const forget = (slot: SlotInfo) => {
    if (
      slot.unsaved &&
      !window.confirm(`„${slot.title}“ ist in keiner Datei gespeichert. Trotzdem aus der Liste entfernen?`)
    )
      return;
    forgetSlot(slot.id);
    refresh();
  };
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)} style={{ fontSize: 14 }}>
      <summary style={{ cursor: 'pointer' }}>Zuletzt bearbeitet</summary>
      {slots.length === 0 ? (
        <p style={{ margin: '4px 0', color: '#555' }}>Keine weiteren Modelle.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: '4px 0', padding: 0, display: 'grid', gap: 4 }}>
          {slots.map((s) => (
            <li key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                disabled={held.has(s.id)}
                onClick={() => onOpen(s.id)}
                title={held.has(s.id) ? 'In einem anderen Tab offen' : 'In diesem Tab öffnen'}
                style={{ flex: 1, textAlign: 'left', overflowWrap: 'anywhere' }}
              >
                {s.title}
                <span style={{ color: '#555', fontSize: 12 }}>
                  {' '}
                  · {WHEN.format(s.changedAt)}
                  {s.unsaved ? ' · nicht gespeichert' : ''}
                  {held.has(s.id) ? ' · in anderem Tab offen' : ''}
                </span>
              </button>
              <button
                type="button"
                aria-label={`${s.title} aus der Liste entfernen`}
                title="Aus der Liste entfernen"
                disabled={held.has(s.id)}
                onClick={() => forget(s)}
                style={{ display: 'grid', placeItems: 'center', padding: 4 }}
              >
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
