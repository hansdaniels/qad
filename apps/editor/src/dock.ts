import { useCallback, useState, useSyncExternalStore } from 'react';

/** Where the sidebar sits: after the screen's orientation, or as chosen. */
export type Dock = 'auto' | 'bottom' | 'side';

export const DOCKS: readonly { readonly id: Dock; readonly name: string }[] = [
  { id: 'auto', name: 'Leiste automatisch' },
  { id: 'bottom', name: 'Leiste unten' },
  { id: 'side', name: 'Leiste seitlich' },
];

const KEY = 'qad:dock';
const PORTRAIT = '(orientation: portrait)';

function subscribe(onChange: () => void) {
  const query = window.matchMedia(PORTRAIT);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function readDock(): Dock {
  try {
    const stored = localStorage.getItem(KEY);
    return DOCKS.some((d) => d.id === stored) ? (stored as Dock) : 'auto';
  } catch {
    return 'auto';
  }
}

/** The chosen dock, remembered in this browser, and whether the sidebar is below the model. */
export function useDock() {
  const portrait = useSyncExternalStore(subscribe, () => window.matchMedia(PORTRAIT).matches);
  const [dock, setDock] = useState(readDock);
  const choose = useCallback((next: Dock) => {
    setDock(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Only a convenience; the choice lasts until reload.
    }
  }, []);
  return { dock, choose, bottom: dock === 'bottom' || (dock === 'auto' && portrait) };
}
