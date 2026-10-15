import { useCallback, useState } from 'react';
import type { ConstructionSnapshot, Diagnostic, ModelCore } from '@qad/model-core';

interface History {
  readonly core: ModelCore;
  readonly snapshot: ConstructionSnapshot;
  readonly past: readonly ConstructionSnapshot[];
  readonly future: readonly ConstructionSnapshot[];
}

/**
 * Undo and redo over committed states. Every step goes through ModelCore.restore,
 * so a restored state is verified again and becomes the core's next revision.
 * Another core, e.g. an opened file, starts a new history.
 */
export function useHistory(core: ModelCore) {
  const fresh = (): History => ({ core, snapshot: core.snapshot, past: [], future: [] });
  let [history, setHistory] = useState<History>(fresh);
  if (history.core !== core) {
    history = fresh();
    setHistory(history);
  }

  const commit = useCallback((next: ConstructionSnapshot) => {
    setHistory((h) => ({ ...h, snapshot: next, past: [...h.past, h.snapshot], future: [] }));
  }, []);

  const step = useCallback(
    (direction: 'undo' | 'redo'): readonly Diagnostic[] => {
      const target = direction === 'undo' ? history.past.at(-1) : history.future[0];
      if (!target) return [];
      const result = core.restore(target);
      if (!result.ok) return result.diagnostics;
      setHistory((h) =>
        direction === 'undo'
          ? { ...h, snapshot: result.value, past: h.past.slice(0, -1), future: [h.snapshot, ...h.future] }
          : { ...h, snapshot: result.value, past: [...h.past, h.snapshot], future: h.future.slice(1) },
      );
      return [];
    },
    [core, history],
  );

  return {
    snapshot: history.snapshot,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    commit,
    undo: () => step('undo'),
    redo: () => step('redo'),
  };
}
