import { Grid, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  attachPoints,
  attachTube,
  billOfMaterials,
  insertPlate,
  plateOfPart,
  plateSpots,
  quadroArticleCatalog,
  quadroPartCatalog,
  recolourPlate,
  recolourTube,
  removePlate,
  removeTube,
  tubeOfPart,
  type AttachPoint,
  type ColourId,
  type Diagnostic,
  type EditCommand,
  type EditPreview,
  type ModelCore,
  type PartId,
  type PlateSpot,
} from '@qad/model-core';
import { BillOfMaterials, billCsv } from './BillOfMaterials';
import { COLOUR_RANGES, colourName, fitColour, familyColours, type ColourRange } from './colours';
import { ModelScene, useOpenEnds, useParts } from './ModelScene';
import { Palette, type PaletteChoice } from './Palette';
import { PlateSpots } from './PlateSpots';
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

/** Valid before invalid, then the fewest tubes that change to another drilling. */
const rank = (p: EditPreview) => (p.status === 'valid' ? p.variantChanges.filter((c) => c.nonstandard).length : 1e6);

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
  const [plateHover, setPlateHover] = useState<PlateSpot | undefined>();
  // The other flange direction than the preferred one, for the cell under the pointer.
  const [flipped, setFlipped] = useState(false);
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
  const points = useMemo(
    () => (choice?.kind === 'tube' ? attachPoints(snapshot, quadroPartCatalog) : []),
    [choice, snapshot],
  );
  const spots = useMemo(
    () =>
      choice?.kind === 'plate'
        ? plateSpots(snapshot, quadroPartCatalog).filter((s) => s.familyId === choice.familyId)
        : [],
    [choice, snapshot],
  );
  const cells = useMemo(() => [...new Map(spots.map((s) => [s.cellKey, s])).values()], [spots]);
  const current = parts.find((p) => p.part.id === selected);
  const bill = useMemo(() => billOfMaterials(snapshot, quadroArticleCatalog, quadroPartCatalog), [snapshot]);

  // Preview of attaching the chosen tube at the arm under the pointer.
  const plan = useMemo(() => {
    if (choice?.kind !== 'tube' || !hover) return undefined;
    const command = attachTube(snapshot, hover, choice, quadroPartCatalog);
    return { key: armKey(hover), command, preview: core.preview(command) };
  }, [choice, hover, snapshot, core]);

  // Preview of the chosen plate at the cell side under the pointer, best flange direction first.
  const platePlan = useMemo(() => {
    if (choice?.kind !== 'plate' || !plateHover) return undefined;
    const options = spots
      .filter((s) => s.cellKey === plateHover.cellKey)
      .map((spot) => {
        const command = insertPlate(snapshot, spot, choice.colour);
        return { spot, command, preview: core.preview(command) };
      })
      .sort((a, b) => rank(a.preview) - rank(b.preview));
    const chosen = (flipped && options[1]) || options[0];
    return chosen && { ...chosen, alternatives: options.length };
  }, [choice, plateHover, flipped, spots, snapshot, core]);
  const active = plan ?? platePlan;

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
  const placePlate = (spot: PlateSpot) => {
    if (choice?.kind !== 'plate') return;
    apply(platePlan?.spot.cellKey === spot.cellKey ? platePlan.command : insertPlate(snapshot, spot, choice.colour));
  };
  // The tube or plate a selected part stands for; connectors stand for none.
  const selectedTube = selected ? tubeOfPart(snapshot, selected) : undefined;
  const selectedPlate = selected ? plateOfPart(snapshot, selected) : undefined;
  const selection = selectedTube
    ? { kind: 'tube' as const, intent: snapshot.design.tubes.find((t) => t.id === selectedTube) }
    : selectedPlate
      ? { kind: 'plate' as const, intent: snapshot.design.plates.find((p) => p.id === selectedPlate) }
      : undefined;
  const recolour = (colour: ColourId) => {
    if (selection?.intent)
      apply(
        selection.kind === 'tube'
          ? recolourTube(snapshot, selection.intent.id, colour)
          : recolourPlate(snapshot, selection.intent.id, colour),
      );
  };
  const remove = () => {
    if (!selection?.intent) return;
    const command =
      selection.kind === 'tube'
        ? removeTube(snapshot, selection.intent.id)
        : removePlate(snapshot, selection.intent.id);
    if (apply(command)) setSelected(undefined);
  };
  const chooseRange = (next: ColourRange) => {
    setRange(next);
    if (choice) setChoice({ ...choice, colour: fitColour(choice.familyId, choice.colour, next) });
  };
  const run = (step: () => readonly Diagnostic[]) => {
    setHover(undefined);
    setPlateHover(undefined);
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
    setPlateHover(undefined);
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
      } else if (!mod && event.key.toLowerCase() === 'r' && platePlan && platePlan.alternatives > 1) {
        setFlipped(!flipped);
      } else if (event.key === 'Delete') {
        event.preventDefault();
        remove();
      } else if (event.key === 'Escape') {
        setChoice(undefined);
        setHover(undefined);
        setPlateHover(undefined);
        setSelected(undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const shown = active?.preview.status === 'invalid' ? unbuildable(active.preview.diagnostics) : notice;
  const special = active?.preview.status === 'valid' ? active.preview.variantChanges.filter((c) => c.nonstandard) : [];

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
            candidate={active?.preview.status === 'valid' ? active.preview.candidate : undefined}
          >
            {choice?.kind === 'tube' ? (
              <VirtualArms
                points={points}
                hovered={plan ? { key: plan.key, valid: plan.preview.status === 'valid' } : undefined}
                onHover={setHover}
                onPick={pick}
              />
            ) : null}
            {choice?.kind === 'plate' ? (
              <PlateSpots
                spots={cells}
                hovered={
                  platePlan
                    ? { cellKey: platePlan.spot.cellKey, valid: platePlan.preview.status === 'valid' }
                    : undefined
                }
                onHover={(spot) => {
                  if (spot?.cellKey !== plateHover?.cellKey) setFlipped(false);
                  setPlateHover(spot);
                }}
                onPick={placePlate}
              />
            ) : null}
          </ModelScene>
          {selected && selection?.intent ? (
            <SelectionTools
              key={selected}
              partId={selected}
              revision={snapshot.revision}
              colours={familyColours(selection.intent.familyId, range)}
              colour={selection.intent.appearance.colour}
              onRecolour={recolour}
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
            {special.length > 0 ? (
              <section style={{ fontSize: 14, padding: 8, borderRadius: 4, background: '#fff6e0', color: '#6b4a00' }}>
                <p style={{ margin: '0 0 4px' }}>Braucht Sonderrohre:</p>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {special.map((c) => (
                    <li key={c.partId}>
                      {c.intent.id}: {articleName(c.selectedTypeId)}
                    </li>
                  ))}
                </ul>
                {platePlan && platePlan.alternatives > 1 ? (
                  <p style={{ margin: '4px 0 0' }}>R dreht die Flansche.</p>
                ) : null}
              </section>
            ) : null}
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
                  {colourName(selection?.intent?.appearance.colour ?? current.article?.article.colour)}
                  {current.article?.substituted ? ' (Ersatzfarbe)' : ''}
                </dd>
                <dt>ID</dt>
                <dd style={{ fontFamily: 'monospace' }}>{current.part.id}</dd>
              </dl>
            ) : null}
            {current ? (
              selection ? (
                <button type="button" onClick={remove} title="Entf">
                  {selection.kind === 'plate'
                    ? 'Platte löschen'
                    : current.part.origin.intent.kind === 'tube'
                      ? 'Rohr löschen'
                      : 'Schräges Rohr löschen'}
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
