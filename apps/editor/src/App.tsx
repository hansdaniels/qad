import { Grid, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import {
  attachPoints,
  attachTube,
  quadroArticleCatalog,
  quadroPartCatalog,
  type AttachPoint,
  type EditCommand,
  type EditPreview,
  type PartId,
} from '@qad/model-core';
import { demoModel } from './demo';
import { ModelScene, useOpenEnds, useParts } from './ModelScene';
import { Palette, type PaletteChoice } from './Palette';
import { VirtualArms } from './VirtualArms';

const articleName = (typeId: string) => quadroArticleCatalog.entries.find((e) => e.id === typeId)?.name ?? typeId;

interface Pending {
  readonly point: AttachPoint;
  readonly command: EditCommand;
  readonly preview: EditPreview;
}

export function App() {
  const core = useMemo(() => demoModel(), []);
  const [snapshot, setSnapshot] = useState(core.snapshot);
  const [selected, setSelected] = useState<PartId | undefined>();
  const [choice, setChoice] = useState<PaletteChoice | undefined>();
  const [pending, setPending] = useState<Pending | undefined>();
  const parts = useParts(snapshot);
  const openEnds = useOpenEnds(snapshot);
  const points = useMemo(() => (choice ? attachPoints(snapshot, quadroPartCatalog) : []), [choice, snapshot]);
  const current = parts.find((p) => p.part.id === selected);

  const pick = (point: AttachPoint) => {
    if (!choice) return;
    const command = attachTube(snapshot, point, choice);
    setPending({ point, command, preview: core.preview(command) });
  };
  const confirm = () => {
    if (!pending) return;
    const result = core.execute(pending.command);
    if (result.ok) setSnapshot(result.value);
    setPending(undefined);
  };
  const choose = (next: PaletteChoice | undefined) => {
    setChoice(next);
    setPending(undefined);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPending(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
            candidate={pending?.preview.status === 'valid' ? pending.preview.candidate : undefined}
          >
            {choice ? <VirtualArms points={points} pending={pending?.point} onPick={pick} /> : null}
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
        <Palette choice={choice} onChoose={choose} />
        {pending ? (
          <section style={{ fontSize: 14, padding: 8, borderRadius: 4, background: '#f6f7f9' }}>
            {pending.preview.status === 'valid' ? (
              <>
                <p style={{ margin: '0 0 8px' }}>
                  Vorschau: Rohr an {pending.point.junctionId}, Richtung {pending.point.direction}.
                </p>
                <button type="button" onClick={confirm}>
                  Anbauen
                </button>{' '}
                <button type="button" onClick={() => setPending(undefined)}>
                  Abbrechen
                </button>
              </>
            ) : (
              <>
                <p style={{ margin: '0 0 8px', color: '#b00020' }}>Nicht baubar:</p>
                <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
                  {pending.preview.diagnostics.map((d, i) => (
                    <li key={i}>{d.message}</li>
                  ))}
                </ul>
                <button type="button" onClick={() => setPending(undefined)}>
                  Schließen
                </button>
              </>
            )}
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
