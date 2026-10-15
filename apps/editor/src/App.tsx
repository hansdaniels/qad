import { Grid, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useMemo, useState } from 'react';
import { quadroArticleCatalog, type PartId } from '@qad/model-core';
import { demoModel } from './demo';
import { ModelScene, useOpenEnds, useParts } from './ModelScene';

const articleName = (typeId: string) => quadroArticleCatalog.entries.find((e) => e.id === typeId)?.name ?? typeId;

export function App() {
  const core = useMemo(() => demoModel(), []);
  const snapshot = core.snapshot;
  const [selected, setSelected] = useState<PartId | undefined>();
  const parts = useParts(snapshot);
  const openEnds = useOpenEnds(snapshot);
  const current = parts.find((p) => p.part.id === selected);
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
          <ModelScene snapshot={snapshot} selected={selected} onSelect={setSelected} />
          <OrbitControls makeDefault target={[200, 100, -200]} />
        </Canvas>
      </div>
      <aside style={{ width: 300, padding: 16, borderLeft: '1px solid #d0d5db', background: '#fff' }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>QUADRO-Editor</h2>
        <p style={{ color: '#555', fontSize: 14 }}>
          Revision {snapshot.revision} · {snapshot.realization.parts.length} Teile · {openEnds.length} offene Enden
        </p>
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
