import { Grid, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  attachPoints,
  attachTube,
  billOfMaterials,
  quadroArticleCatalog,
  quadroPartCatalog,
  recolourTube,
  removeTube,
  tubeOfPart,
  type AttachPoint,
  type Diagnostic,
  type EditCommand,
  type ModelCore,
  type PartId,
} from '@qad/model-core';
import { BillOfMaterials, billCsv } from './BillOfMaterials';
import { COLOUR_RANGES, colourName, fitColour, tubeColours, type ColourRange } from './colours';
import { ModelScene, useOpenEnds, useParts } from './ModelScene';
import { Palette, type PaletteChoice } from './Palette';
import { SelectionTools } from './SelectionTools';
import { emptyModel } from './models';
import { DEFAULT_FILE_NAME, download, downloadModel, openModel, restoreModel, storeModel } from './storage';
import { useHistory } from './useHistory';
import { VirtualArms, armKey } from './VirtualArms';

const articleName = (typeId: string) => quadroArticleCatalog.entries.find((e) => e.id === typeId)?.name ?? typeId;

interface Notice {
  readonly title: string;
  readonly diagnostics: readonly Diagnostic[];
}
const unbuildable = (diagnostics: readonly Diagnostic[]): Notice | undefined =>
  diagnostics.length > 0 ? { title: 'Nicht baubar:', diagnostics } : undefined;

export function App() {
  const [restored] = useState(restoreModel);
  const [core, setCore] = useState(restored.core);
  const [fileName, setFileName] = useState(restored.info.fileName);
  // Design as last saved to or opened from a file; undefined when that is unknown.
  const [savedDesign, setSavedDesign] = useState(restored.info.unsaved ? undefined : restored.core.snapshot.design);
  const fileInput = useRef<HTMLInputElement>(null);
  const { snapshot, canUndo, canRedo, commit, undo, redo } = useHistory(core);
  const unsaved = snapshot.design !== savedDesign;
  const [selected, setSelected] = useState<PartId | undefined>();
  const [choice, setChoice] = useState<PaletteChoice | undefined>();
  const [hover, setHover] = useState<AttachPoint | undefined>();
  const [range, setRange] = useState<ColourRange>('both');
  const [view, setView] = useState<'build' | 'bill'>('build');
  const [highlighted, setHighlighted] = useState<ReadonlySet<PartId>>(new Set());
  const [notice, setNotice] = useState<Notice | undefined>(
    restored.problems && {
      title: 'Das zuletzt bearbeitete Modell ließ sich nicht öffnen:',
      diagnostics: restored.problems,
    },
  );
  const parts = useParts(snapshot);
  const openEnds = useOpenEnds(snapshot);
  const points = useMemo(() => (choice ? attachPoints(snapshot, quadroPartCatalog) : []), [choice, snapshot]);
  const current = parts.find((p) => p.part.id === selected);
  const bill = useMemo(() => billOfMaterials(snapshot, quadroArticleCatalog), [snapshot]);

  // Preview of attaching the chosen tube at the arm under the pointer.
  const plan = useMemo(() => {
    if (!choice || !hover) return undefined;
    const command = attachTube(snapshot, hover, choice, quadroPartCatalog);
    return { key: armKey(hover), command, preview: core.preview(command) };
  }, [choice, hover, snapshot, core]);

  const apply = (command: EditCommand): boolean => {
    const result = core.execute(command);
    if (result.ok) {
      commit(result.value);
      setNotice(undefined);
    } else {
      setNotice(unbuildable(result.diagnostics));
    }
    return result.ok;
  };
  const pick = (point: AttachPoint) => {
    if (!choice) return;
    apply(plan?.key === armKey(point) ? plan.command : attachTube(snapshot, point, choice, quadroPartCatalog));
  };
  const selectedTube = selected ? tubeOfPart(snapshot, selected) : undefined;
  const selectedTubeIntent = snapshot.design.tubes.find((t) => t.id === selectedTube);
  const remove = () => {
    if (!selectedTube) return;
    if (apply(removeTube(snapshot, selectedTube))) setSelected(undefined);
  };
  const chooseRange = (next: ColourRange) => {
    setRange(next);
    if (choice) setChoice({ ...choice, colour: fitColour(choice.familyId, choice.colour, next) });
  };
  const run = (step: () => readonly Diagnostic[]) => {
    setHover(undefined);
    setNotice(unbuildable(step()));
  };

  useEffect(() => storeModel(snapshot, { fileName, unsaved }), [snapshot, fileName, unsaved]);

  const discardOk = () =>
    !unsaved || window.confirm('Die Änderungen am Modell sind in keiner Datei gespeichert. Trotzdem verwerfen?');
  const switchTo = (next: ModelCore, name: string) => {
    setCore(next);
    setFileName(name);
    setSavedDesign(next.snapshot.design);
    setSelected(undefined);
    setChoice(undefined);
    setHover(undefined);
    setNotice(undefined);
  };
  const newModel = () => {
    if (discardOk()) switchTo(emptyModel(), DEFAULT_FILE_NAME);
  };
  const openFile = () => {
    if (discardOk()) fileInput.current?.click();
  };
  const readFile = async (file: File) => {
    const opened = openModel(await file.text());
    if (opened.ok) switchTo(opened.value, file.name);
    else setNotice({ title: `${file.name} ließ sich nicht öffnen:`, diagnostics: opened.diagnostics });
  };
  const exportBill = () => download(billCsv(bill), 'text/csv', `${fileName.replace(/\.json$/i, '')}-stueckliste.csv`);
  const saveFile = () => {
    downloadModel(snapshot, fileName);
    setSavedDesign(snapshot.design);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveFile();
      } else if (mod && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        openFile();
      } else if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        run(event.shiftKey ? redo : undo);
      } else if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        run(redo);
      } else if (event.key === 'Delete') {
        event.preventDefault();
        remove();
      } else if (event.key === 'Escape') {
        setChoice(undefined);
        setHover(undefined);
        setSelected(undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const shown = plan?.preview.status === 'invalid' ? unbuildable(plan.preview.diagnostics) : notice;

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
            highlighted={view === 'bill' ? highlighted : undefined}
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
          {selected && selectedTube ? (
            <SelectionTools
              key={selected}
              partId={selected}
              revision={snapshot.revision}
              colours={selectedTubeIntent ? tubeColours(selectedTubeIntent.familyId, range) : []}
              colour={selectedTubeIntent?.appearance.colour}
              onRecolour={(colour) =>
                selectedTubeIntent && apply(recolourTube(snapshot, selectedTubeIntent.id, colour))
              }
              onDelete={remove}
            />
          ) : null}
          <OrbitControls makeDefault target={[200, 100, -200]} />
        </Canvas>
      </div>
      <aside
        style={{ width: 300, padding: 16, borderLeft: '1px solid #d0d5db', background: '#fff', overflowY: 'auto' }}
      >
        <h2 style={{ marginTop: 0, fontSize: 18 }}>QUADRO-Editor</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={newModel}>
            Neu
          </button>
          <button type="button" onClick={openFile} title="Strg+O">
            Öffnen …
          </button>
          <button type="button" onClick={saveFile} title="Strg+S">
            Speichern
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void readFile(file);
            }}
          />
        </div>
        <p style={{ fontSize: 14, margin: '8px 0 0', overflowWrap: 'anywhere' }}>
          {fileName}
          {unsaved ? <span style={{ color: '#8a5a00' }}> · nicht gespeichert</span> : null}
        </p>
        <div role="tablist" style={{ display: 'flex', gap: 4, margin: '12px 0 0', borderBottom: '1px solid #d0d5db' }}>
          {(
            [
              ['build', 'Bauen'],
              ['bill', 'Stückliste'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              style={{
                padding: '6px 10px',
                border: 'none',
                borderBottom: view === id ? '2px solid #1f5fbf' : '2px solid transparent',
                background: 'none',
                fontWeight: view === id ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {view === 'bill' ? (
          <BillOfMaterials lines={bill} onHighlight={(ids) => setHighlighted(new Set(ids))} onExport={exportBill} />
        ) : (
          <>
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
            <label style={{ display: 'block', marginTop: 12, fontSize: 14 }}>
              Farben{' '}
              <select value={range} onChange={(e) => chooseRange(e.target.value as ColourRange)}>
                {COLOUR_RANGES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <Palette choice={choice} range={range} onChoose={setChoice} />
            {shown ? (
              <section style={{ fontSize: 14, padding: 8, borderRadius: 4, background: '#fdecea', color: '#8a1c1c' }}>
                <p style={{ margin: '0 0 4px' }}>{shown.title}</p>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {shown.diagnostics.map((d, i) => (
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
                  {colourName(selectedTubeIntent?.appearance.colour ?? current.article?.article.colour)}
                  {current.article?.substituted ? ' (Ersatzfarbe)' : ''}
                </dd>
                <dt>ID</dt>
                <dd style={{ fontFamily: 'monospace' }}>{current.part.id}</dd>
              </dl>
            ) : null}
            {current ? (
              selectedTube ? (
                <button type="button" onClick={remove} title="Entf">
                  {current.part.origin.intent.kind === 'tube' ? 'Rohr löschen' : 'Schräges Rohr löschen'}
                </button>
              ) : (
                <p style={{ fontSize: 13, color: '#555' }}>
                  Kupplungen entstehen automatisch aus den Rohren und verschwinden mit ihnen.
                </p>
              )
            ) : (
              <p style={{ fontSize: 14 }}>Teil anklicken für Details.</p>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
