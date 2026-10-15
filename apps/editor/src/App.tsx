import { Grid, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import {
  attachPoints,
  attachTube,
  quadroArticleCatalog,
  quadroPartCatalog,
  type AttachPoint,
  type Diagnostic,
  type PartId,
} from '@qad/model-core';
import { demoModel } from './demo';
import { ModelScene, useOpenEnds, useParts } from './ModelScene';
import { Palette, type PaletteChoice } from './Palette';
import { useHistory } from './useHistory';
import { VirtualArms, armKey } from './VirtualArms';

const articleName = (typeId: string) => quadroArticleCatalog.entries.find((e) => e.id === typeId)?.name ?? typeId;

export function App() {
  const core = useMemo(() => demoModel(), []);
  const { snapshot, canUndo, canRedo, commit, undo, redo } = useHistory(core);
  const [selected, setSelected] = useState<PartId | undefined>();
  const [choice, setChoice] = useState<PaletteChoice | undefined>();
  const [hover, setHover] = useState<AttachPoint | undefined>();
  const [notice, setNotice] = useState<readonly Diagnostic[]>([]);
  const parts = useParts(snapshot);
  const openEnds = useOpenEnds(snapshot);
  const points = useMemo(() => (choice ? attachPoints(snapshot, quadroPartCatalog) : []), [choice, snapshot]);
  const current = parts.find((p) => p.part.id === selected);

  // Preview of attaching the chosen tube at the arm under the pointer.
  const plan = useMemo(() => {
    if (!choice || !hover) return undefined;
    const command = attachTube(snapshot, hover, choice, quadroPartCatalog);
    return { key: armKey(hover), command, preview: core.preview(command) };
  }, [choice, hover, snapshot, core]);

  const pick = (point: AttachPoint) => {
    if (!choice) return;
    const command = plan?.key === armKey(point) ? plan.command : attachTube(snapshot, point, choice, quadroPartCatalog);
    const result = core.execute(command);
    if (result.ok) {
      commit(result.value);
      setNotice([]);
    } else {
      setNotice(result.diagnostics);
    }
  };
  const run = (step: () => readonly Diagnostic[]) => {
    setHover(undefined);
    setNotice(step());
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        run(event.shiftKey ? redo : undo);
      } else if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        run(redo);
      } else if (event.key === 'Escape') {
        setChoice(undefined);
        setHover(undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const problems = plan?.preview.status === 'invalid' ? plan.preview.diagnostics : notice;

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, background: '#eef1f4' }}>
        <Canvas
          camera={{ position: [1300, 900, 900], fov: 40, near: 10, far: 50000 }}
          onPointerMissed={() => setSelected(undefined)}
        >
          <ambientLight intensity={0.7} />
          <directionalLight position={[2000, 3000, 1500]} intensity={1.6} />
          <Grid
            position={[0, -25, 0]}
            cellSize={100}
            sectionSize={400}
            infiniteGrid
            fadeDistance={6000}
            cellColor="#c8cdd3"
            sectionColor="#9aa3ad"
          />
          <ModelScene
            snapshot={snapshot}
            selected={selected}
            onSelect={setSelected}
            candidate={plan?.preview.status === 'valid' ? plan.preview.candidate : undefined}
          >
            {choice ? (
              <VirtualArms
                points={points}
                hovered={plan ? { key: plan.key, valid: plan.preview.status === 'valid' } : undefined}
                onHover={setHover}
                onPick={pick}
              />
            ) : null}
          </ModelScene>
          <OrbitControls makeDefault target={[200, 100, -200]} />
        </Canvas>
      </div>
      <aside
        style={{ width: 300, padding: 16, borderLeft: '1px solid #d0d5db', background: '#fff', overflowY: 'auto' }}
      >
        <h2 style={{ marginTop: 0, fontSize: 18 }}>QUADRO-Editor</h2>
        <p style={{ color: '#555', fontSize: 14 }}>
          Revision {snapshot.revision} · {snapshot.realization.parts.length} Teile · {openEnds.length} offene Enden
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" disabled={!canUndo} onClick={() => run(undo)} title="Strg+Z">
            Zurück
          </button>
          <button type="button" disabled={!canRedo} onClick={() => run(redo)} title="Strg+Y oder Strg+Umschalt+Z">
            Wiederholen
          </button>
        </div>
        <Palette choice={choice} onChoose={setChoice} />
        {problems.length > 0 ? (
          <section style={{ fontSize: 14, padding: 8, borderRadius: 4, background: '#fdecea', color: '#8a1c1c' }}>
            <p style={{ margin: '0 0 4px' }}>Nicht baubar:</p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {problems.map((d, i) => (
                <li key={i}>{d.message}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <h3 style={{ fontSize: 15, margin: '16px 0 8px' }}>Auswahl</h3>
        {current ? (
          <dl style={{ fontSize: 14 }}>
            <dt>Teil</dt>
            <dd>{articleName(current.part.typeId)}</dd>
            <dt>Artikelnummer</dt>
            <dd>{current.article?.article.articleNumber ?? '–'}</dd>
            <dt>Farbe</dt>
            <dd>
              {current.article?.article.colour ?? '–'}
              {current.article?.substituted ? ' (Ersatzfarbe)' : ''}
            </dd>
            <dt>ID</dt>
            <dd style={{ fontFamily: 'monospace' }}>{current.part.id}</dd>
          </dl>
        ) : (
          <p style={{ fontSize: 14 }}>Teil anklicken für Details.</p>
        )}
      </aside>
    </div>
  );
}
