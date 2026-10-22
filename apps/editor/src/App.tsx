import { Grid } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Expand, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  assemblyOf,
  attachPoints,
  connectionSnaps,
  attachTube,
  copyParts,
  encodeFragment,
  isFragment,
  parseFragment,
  pasteFragment,
  removeParts,
  renameModel,
  bendDirections,
  obliqueDirections,
  billOfMaterials,
  compareConstructions,
  findHeadTraps,
  insertPlate,
  insertSlide,
  isPlan,
  math,
  moveAssembly,
  plateOfPart,
  plateSpots,
  slideOfPart,
  slideSpots,
  quadroArticleCatalog,
  quadroPartCatalog,
  recolourPlate,
  recolourSlide,
  recolourTube,
  removePlate,
  removeSlide,
  removeTube,
  tubeOfPart,
  turnPlate,
  turnTube,
  type AttachOptions,
  type AttachPoint,
  type ColourId,
  type ConstructionSnapshot,
  type Diagnostic,
  type EditCommand,
  type EditPreview,
  type ModelCore,
  type PartId,
  type PlateSpot,
  type SlideSpot,
  type Vector3,
  type Pose,
} from '@qad/model-core';
import { ASSORTMENTS, inAssortment, type Assortment } from './assortment';
import { BillOfMaterials, billCsv } from './BillOfMaterials';
import { BoxSelect } from './BoxSelect';
import { CameraRig, VIEWS, type ViewId } from './CameraRig';
import { GhostTurn } from './GhostTurn';
import { DOCKS, useDock, type Dock } from './dock';
import { COLOUR_RANGES, colourName, fitColour, familyColours, type ColourRange } from './colours';
import { ModelScene, useOpenEnds, useParts, type Mark } from './ModelScene';
import { CHANGE_COLOURS, Rebuild } from './Rebuild';
import { MoveGizmo } from './MoveGizmo';
import { Palette, type PaletteChoice } from './Palette';
import { PlateSpots } from './PlateSpots';
import { SelectionTools } from './SelectionTools';
import { SlideSpots } from './SlideSpots';
import { emptyModel } from './models';
import { RecentModels } from './RecentModels';
import { activeSlot, freshSlot, switchSlot, type Slot } from './slots';
import {
  DEFAULT_FILE_NAME,
  download,
  downloadModel,
  modelFileName,
  modelTitle,
  openModel,
  openPlan,
  restoreModel,
  storeModel,
} from './storage';
import { useHistory } from './useHistory';
import { VirtualArms, armKey } from './VirtualArms';
import { Warnings } from './Warnings';

// Variants without an article of their own, e.g. a bent half plate, go by their part type name.
const articleName = (typeId: string) =>
  quadroArticleCatalog.entries.find((e) => e.id === typeId)?.name ??
  quadroPartCatalog.partTypes.find((t) => t.id === typeId)?.name ??
  typeId;
const CURVED = new Set(
  quadroPartCatalog.partTypes.flatMap((t) => (t.kind === 'tube' && t.shape === 'bent' ? [t.familyId] : [])),
);

interface Notice {
  readonly title: string;
  readonly diagnostics: readonly Diagnostic[];
  /** Information rather than a problem. */
  readonly info?: boolean;
}
const unbuildable = (diagnostics: readonly Diagnostic[]): Notice | undefined =>
  diagnostics.length > 0 ? { title: 'Nicht baubar:', diagnostics } : undefined;
const hint = (title: string, message: string): Notice => ({
  title,
  diagnostics: [{ code: 'invalid-data', severity: 'warning', message, subjects: [] }],
  info: true,
});
/** How often a paste tries one grid step further out when its place beside the model is taken. */
const PASTE_TRIES = 6;

/** Snapping of a moved assembly: the grid of a 35 cm tube, and how near a fitting place must come. */
const GRID_MM = 400;
const SNAP_MM = 150;
/** Arrow keys move along model x and y: right, and away from the front. */
const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

/** Valid before invalid, then the fewest tubes that change to another drilling. */
const rank = (p: EditPreview) => (p.status === 'valid' ? p.variantChanges.filter((c) => c.nonstandard).length : 1e6);

/** A point at distance along a frame's +Z, e.g. beyond an arm or above a plate. */
function ahead(pose: Pose, distance: number): [number, number, number] {
  const p = math.compose(pose, {
    position: math.vec(0, 0, distance),
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  }).position;
  return [p.x, p.y, p.z];
}

export function App({ initialSlot }: { readonly initialSlot: Slot }) {
  // After a hot reload the page may already work in another slot than the one it started with.
  const [slot, setSlot] = useState(() => activeSlot() ?? initialSlot);
  const [restored] = useState(() => restoreModel(slot.id));
  const [core, setCore] = useState(restored.core);
  const [fileName, setFileName] = useState(restored.info.fileName);
  // Design as last saved to or opened from a file; undefined when that is unknown.
  const [savedDesign, setSavedDesign] = useState(restored.info.unsaved ? undefined : restored.core.snapshot.design);
  const fileInput = useRef<HTMLInputElement>(null);
  const { snapshot, canUndo, canRedo, commit, undo, redo } = useHistory(core);
  const unsaved = snapshot.design !== savedDesign;
  // Selected parts; tools for a single part show only while exactly one is selected.
  const [picked, setPicked] = useState<ReadonlySet<PartId>>(new Set());
  const selected = picked.size === 1 ? [...picked][0] : undefined;
  const setSelected = (id: PartId | undefined) => setPicked(new Set(id === undefined ? [] : [id]));
  const pick1 = (id: PartId, additive: boolean) => {
    if (!additive) return setSelected(id);
    const next = new Set(picked);
    if (!next.delete(id)) next.add(id);
    setPicked(next);
  };
  // The last copy, for the paste button where the page may not read the clipboard.
  const copied = useRef<string | undefined>(undefined);
  // Set by a paste, so the pasted assembly is ready to be moved once it is selected.
  const moveNext = useRef(false);
  const [choice, setChoice] = useState<PaletteChoice | undefined>();
  const [hover, setHover] = useState<AttachPoint | undefined>();
  const [plateHover, setPlateHover] = useState<PlateSpot | undefined>();
  const [slideHover, setSlideHover] = useState<SlideSpot | undefined>();
  // Moving the selected part's assembly: the handle's snapped translation while dragging.
  const [moveMode, setMoveMode] = useState(false);
  const [drag, setDrag] = useState<
    { readonly x: number; readonly y: number; readonly z: number; readonly label?: string } | undefined
  >();
  const gizmoUsed = useRef(0);
  // Which tube fits after a click on an arrow stopped at a fitting place.
  const [stepLabel, setStepLabel] = useState<string | undefined>();
  // Steps through the alternatives at the place under the pointer: flange or bend direction.
  const [turn, setTurn] = useState(0);
  const [range, setRange] = useState<ColourRange>('both');
  const [assortment, setAssortment] = useState<Assortment>('common');
  const [view, setView] = useState<'build' | 'bill' | 'rebuild'>('build');
  // Another model file to compare with, e.g. the state before a rebuild.
  const [reference, setReference] = useState<{ readonly name: string; readonly snapshot: ConstructionSnapshot }>();
  const [referenceBefore, setReferenceBefore] = useState(true);
  const [onlyChanges, setOnlyChanges] = useState(true);
  const referenceInput = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState<ViewId>('perspective');
  const { dock, choose: chooseDock, bottom } = useDock();
  const [fit, setFit] = useState(0);
  // Exploded view: tubes and plates smaller, connector arms showing.
  const [exploded, setExploded] = useState(false);
  const [zoom, setZoom] = useState<{ readonly count: number; readonly direction: 1 | -1 }>({ count: 0, direction: 1 });
  const zoomBy = (direction: 1 | -1) => setZoom((z) => ({ count: z.count + 1, direction }));
  const [highlighted, setHighlighted] = useState<ReadonlySet<PartId>>(new Set());
  const [notice, setNotice] = useState<Notice | undefined>(
    restored.problems && {
      title: 'Das zuletzt bearbeitete Modell ließ sich nicht öffnen:',
      diagnostics: restored.problems,
    },
  );
  const parts = useParts(snapshot);
  const partNames = useMemo(() => new Set(parts.map((p) => p.part.id)), [parts]);
  const openEnds = useOpenEnds(snapshot);
  const points = useMemo(
    () => (choice?.kind === 'tube' ? attachPoints(snapshot, quadroPartCatalog) : []),
    [choice, snapshot],
  );
  const spots = useMemo(
    () =>
      choice?.kind === 'plate'
        ? plateSpots(snapshot, quadroPartCatalog).filter(
            // Level places have their plate normal up or down, upright ones across.
            (s) =>
              s.familyId === choice.familyId &&
              Math.abs(math.rotate(s.worldPose.orientation, math.vec(0, 0, 1)).z) < 0.5 === (choice.upright ?? false),
          )
        : [],
    [choice, snapshot],
  );
  const cells = useMemo(() => [...new Map(spots.map((s) => [s.cellKey, s])).values()], [spots]);
  const slideTargets = useMemo(
    () =>
      choice?.kind === 'slide'
        ? slideSpots(snapshot, quadroPartCatalog).filter((s) => s.familyId === choice.familyId)
        : [],
    [choice, snapshot],
  );
  const current = parts.find((p) => p.part.id === selected);
  const bill = useMemo(() => billOfMaterials(snapshot, quadroArticleCatalog, quadroPartCatalog), [snapshot]);
  const comparison = useMemo(() => {
    if (!reference) return undefined;
    const [before, after] = referenceBefore ? [reference.snapshot, snapshot] : [snapshot, reference.snapshot];
    return compareConstructions(before, after, quadroPartCatalog, quadroArticleCatalog);
  }, [reference, referenceBefore, snapshot]);
  // In the rebuild view the current model's parts get the contour of their change,
  // and the other file's parts missing here show see-through at their place.
  const rebuild = useMemo(() => {
    if (view !== 'rebuild' || !comparison || !reference) return undefined;
    const marks = new Map<PartId, Mark>();
    const others = new Map<PartId, Mark>();
    for (const change of comparison.changes) {
      const [here, there] = referenceBefore ? [change.after, change.before] : [change.before, change.after];
      const outline = change.kind === 'kept' ? undefined : CHANGE_COLOURS[change.kind];
      if (here) marks.set(here.partId, outline ? { outline } : onlyChanges ? { opacity: 0.2 } : {});
      if (!here && there) others.set(there.partId, { outline: outline!, opacity: 0.35 });
      if (change.kind === 'moved' && there) others.set(there.partId, { opacity: 0.2 });
    }
    return { marks, others: { snapshot: reference.snapshot, marks: others } };
  }, [view, comparison, reference, referenceBefore, onlyChanges]);
  const traps = useMemo(() => findHeadTraps(snapshot, quadroPartCatalog), [snapshot]);

  // Preview of attaching the chosen tube at the arm under the pointer. A curved tube
  // offers its four bend directions, buildable ones first. A straight tube is axial
  // first, then oblique on an angle adapter, previewed only when turned to.
  const plan = useMemo(() => {
    if (choice?.kind !== 'tube' || !hover) return undefined;
    const preview = (options: AttachOptions) => {
      const command = attachTube(snapshot, hover, choice, quadroPartCatalog, options);
      return { key: armKey(hover), command, preview: core.preview(command) };
    };
    if (CURVED.has(choice.familyId)) {
      const options = bendDirections(hover.direction)
        .map((bend) => preview({ bend }))
        .sort((a, b) => Number(a.preview.status !== 'valid') - Number(b.preview.status !== 'valid'));
      const anyValid = options[0]?.preview.status === 'valid';
      return { ...options[turn % options.length]!, alternatives: anyValid ? options.length : 1 };
    }
    // An angle adapter needs a connector, so a junction without tubes offers none.
    const carries = snapshot.design.tubes.some(
      (t) => t.a.junctionId === hover.junctionId || t.b.junctionId === hover.junctionId,
    );
    const options: AttachOptions[] = [
      {},
      ...(carries ? obliqueDirections(hover.direction).map((oblique) => ({ oblique })) : []),
    ];
    return { ...preview(options[turn % options.length]!), alternatives: options.length };
  }, [choice, hover, turn, snapshot, core]);

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
    const chosen = options[turn % Math.max(1, options.length)];
    // Sorted buildable first: when the first is not, turning shows nothing buildable.
    const anyValid = options[0]?.preview.status === 'valid';
    return chosen && { ...chosen, alternatives: anyValid ? options.length : 1 };
  }, [choice, plateHover, turn, spots, snapshot, core]);
  // Preview of the chosen slide at the spot under the pointer; it has no other positions.
  const slidePlan = useMemo(() => {
    if (choice?.kind !== 'slide' || !slideHover) return undefined;
    const command = insertSlide(snapshot, slideHover, choice.colour);
    return { spot: slideHover, command, preview: core.preview(command), alternatives: 1 };
  }, [choice, slideHover, snapshot, core]);
  const active = plan ?? platePlan ?? slidePlan;

  const assembly = useMemo(
    () => (moveMode && selected ? assemblyOf(snapshot, selected) : undefined),
    [moveMode, selected, snapshot],
  );
  const snaps = useMemo(
    () => (assembly ? connectionSnaps(snapshot, quadroPartCatalog, assembly, 0) : []),
    [assembly, snapshot],
  );
  const movePlan = useMemo(() => {
    if (!assembly || !drag || (drag.x === 0 && drag.y === 0 && drag.z === 0)) return undefined;
    const command = moveAssembly(snapshot, assembly, {
      translation: math.vec(drag.x, drag.y, drag.z),
      quarterTurns: 0,
    });
    return { command, preview: core.preview(command) };
  }, [assembly, drag, snapshot, core]);
  const moved = useMemo(() => new Set(assembly?.partIds ?? []), [assembly]);
  useEffect(() => {
    setMoveMode(moveNext.current);
    moveNext.current = false;
    setDrag(undefined);
    setStepLabel(undefined);
  }, [selected]);

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
  /** Applies an insertion; a new part with other positions is selected, so it can be turned. */
  // The preview outlasts the pointer leaving its target by a moment, so the turn
  // button and the ghost can be reached; reaching either keeps it.
  const release = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const holdPreview = () => clearTimeout(release.current);
  const releasePreview = () => {
    clearTimeout(release.current);
    release.current = setTimeout(() => {
      setHover(undefined);
      setPlateHover(undefined);
      setSlideHover(undefined);
    }, 1000);
  };
  const previewHover = (inside: boolean) => (inside ? holdPreview() : releasePreview());
  useEffect(() => () => clearTimeout(release.current), []);
  const insert = (command: EditCommand) => {
    if (!apply(command)) return;
    setHover(undefined);
    setPlateHover(undefined);
    setSlideHover(undefined);
    const added = command.operations.find((op) => op.kind === 'add-plate' || op.kind === 'add-tube');
    const intent =
      added?.kind === 'add-plate'
        ? { kind: 'plate', id: added.plate.id }
        : added?.kind === 'add-tube' && (CURVED.has(added.tube.familyId) || added.tube.a.adapterArm)
          ? { kind: 'tube', id: added.tube.id }
          : undefined;
    if (intent) setSelected(`${intent.kind}:${intent.id}/body`);
  };
  const pick = (point: AttachPoint) => {
    if (!choice) return;
    insert(plan?.key === armKey(point) ? plan.command : attachTube(snapshot, point, choice, quadroPartCatalog));
  };
  const placePlate = (spot: PlateSpot) => {
    if (choice?.kind !== 'plate') return;
    insert(platePlan?.spot.cellKey === spot.cellKey ? platePlan.command : insertPlate(snapshot, spot, choice.colour));
  };
  const placeSlide = (spot: SlideSpot) => {
    if (choice?.kind !== 'slide') return;
    insert(slidePlan?.spot.key === spot.key ? slidePlan.command : insertSlide(snapshot, spot, choice.colour));
  };
  // The tube, plate or slide a selected part stands for; connectors stand for none.
  const selectedTube = selected ? tubeOfPart(snapshot, selected) : undefined;
  const selectedPlate = selected ? plateOfPart(snapshot, selected) : undefined;
  const selectedSlide = selected ? slideOfPart(snapshot, selected) : undefined;
  const selection = selectedTube
    ? { kind: 'tube' as const, intent: snapshot.design.tubes.find((t) => t.id === selectedTube) }
    : selectedPlate
      ? { kind: 'plate' as const, intent: snapshot.design.plates.find((p) => p.id === selectedPlate) }
      : selectedSlide
        ? { kind: 'slide' as const, intent: snapshot.design.slides.find((s) => s.id === selectedSlide) }
        : undefined;
  // Colours the selected part may take, its own one included even outside the range.
  const selectionColours = (() => {
    if (!selection?.intent) return [];
    const offered = familyColours(selection.intent.familyId, range);
    const own = selection.intent.appearance.colour;
    return offered.some((c) => c.id === own) ? offered : [{ id: own, name: colourName(own) }, ...offered];
  })();
  const recolour = (colour: ColourId) => {
    if (selection?.intent)
      apply(
        selection.kind === 'tube'
          ? recolourTube(snapshot, selection.intent.id, colour)
          : selection.kind === 'plate'
            ? recolourPlate(snapshot, selection.intent.id, colour)
            : recolourSlide(snapshot, selection.intent.id, colour),
      );
  };
  // Other positions of the selected part: bends of a curved tube, axial or oblique
  // for a straight tube with a free end, flange directions of a plate.
  const turns = !selection?.intent
    ? []
    : selection.kind === 'plate'
      ? turnPlate(snapshot, selection.intent.id, quadroPartCatalog)
      : selection.kind === 'tube'
        ? turnTube(snapshot, selection.intent.id, quadroPartCatalog)
        : [];
  const turnSelected = () => {
    const previews = turns.map((command) => ({ command, preview: core.preview(command) }));
    const next = previews.find((p) => p.preview.status === 'valid');
    if (next) apply(next.command);
    else if (previews[0])
      setNotice({ title: 'Keine andere Lage ist baubar:', diagnostics: previews[0].preview.diagnostics });
  };
  // Grid steps of a 35 cm tube, or a place where one tube joins this assembly to
  // another; never below the floor.
  const dragTo = (raw: Vector3) => {
    if (!assembly) return;
    const floor = -assembly.lowest;
    let best: (typeof snaps)[number] | undefined;
    let bestDistance = SNAP_MM;
    for (const s of snaps) {
      const d = Math.hypot(s.translation.x - raw.x, s.translation.y - raw.y, s.translation.z - raw.z);
      if (d < bestDistance && s.translation.z >= floor - 1) [best, bestDistance] = [s, d];
    }
    const step = (v: number) => Math.round(v / GRID_MM) * GRID_MM;
    const next = best
      ? { ...best.translation, label: `passt: ${articleName(best.familyId)}` }
      : { x: step(raw.x), y: step(raw.y), z: Math.max(step(raw.z), Math.ceil((floor - 1) / GRID_MM) * GRID_MM) };
    if (next.x !== drag?.x || next.y !== drag?.y || next.z !== drag?.z) setDrag(next);
  };
  const dropMove = () => {
    if (movePlan?.preview.status === 'valid') apply(movePlan.command);
    else if (movePlan) setNotice(unbuildable(movePlan.preview.diagnostics));
    setDrag(undefined);
  };
  // One stop along an axis: the next grid step, or a place nearer where a tube fits.
  const stepAssembly = (axis: 'x' | 'y' | 'z', sign: 1 | -1) => {
    const others = (['x', 'y', 'z'] as const).filter((a) => a !== axis);
    const fitting = snaps
      .filter((s) => others.every((a) => Math.abs(s.translation[a]) < 1) && s.translation[axis] * sign > 1)
      .sort((a, b) => Math.abs(a.translation[axis]) - Math.abs(b.translation[axis]))[0];
    const distance =
      fitting && Math.abs(fitting.translation[axis]) < GRID_MM ? fitting.translation[axis] : sign * GRID_MM;
    const t = { x: 0, y: 0, z: 0, [axis]: distance };
    setDrag(undefined);
    shiftAssembly(t.x, t.y, t.z);
    setStepLabel(distance === fitting?.translation[axis] ? `passt: ${articleName(fitting.familyId)}` : undefined);
  };
  const shiftAssembly = (x: number, y: number, z: number, quarterTurns = 0) => {
    setStepLabel(undefined);
    if (!assembly || assembly.lowest + z < -1) return;
    apply(moveAssembly(snapshot, assembly, { translation: math.vec(x, y, z), quarterTurns }));
  };
  const remove = () => {
    if (!selection?.intent) return;
    const command =
      selection.kind === 'tube'
        ? removeTube(snapshot, selection.intent.id)
        : selection.kind === 'plate'
          ? removePlate(snapshot, selection.intent.id)
          : removeSlide(snapshot, selection.intent.id);
    if (apply(command)) setSelected(undefined);
  };
  const removePicked = () => {
    if (picked.size > 1) {
      if (apply(removeParts(snapshot, [...picked]))) setSelected(undefined);
    } else remove();
  };
  /** The selection as clipboard text; undefined, with a hint, when it holds no tube, plate or slide. */
  const copy = (): string | undefined => {
    const fragment = copyParts(snapshot, quadroPartCatalog, [...picked]);
    if (!fragment) {
      setNotice(
        hint('Nichts zu kopieren:', 'Rohre, Platten oder Rutschen auswählen; Kupplungen kommen mit den Rohren.'),
      );
      return undefined;
    }
    const text = encodeFragment(fragment);
    copied.current = text;
    setNotice(undefined);
    return text;
  };
  /** Pastes copied parts as a loose assembly beside the model, on the floor, ready to be moved. */
  const paste = (text: string) => {
    const parsed = parseFragment(text, quadroPartCatalog);
    if (!parsed.ok) return setNotice({ title: 'Einfügen nicht möglich:', diagnostics: parsed.diagnostics });
    let refused: readonly Diagnostic[] = [];
    for (let further = 0; further < PASTE_TRIES; further++) {
      const command = pasteFragment(snapshot, quadroPartCatalog, parsed.value, further);
      const preview = core.preview(command);
      if (preview.status !== 'valid') {
        if (further === 0) refused = preview.diagnostics;
        continue;
      }
      if (!apply(command)) return;
      const first = command.operations.find((op) => op.kind === 'add-tube');
      moveNext.current = parsed.value.design.anchors.length === 1;
      if (first?.kind === 'add-tube') setSelected(`tube:${first.tube.id}/body`);
      return;
    }
    setNotice(unbuildable(refused));
  };
  const copyButton = () => {
    const text = copy();
    if (text) navigator.clipboard?.writeText(text).catch(() => {});
  };
  const pasteButton = () => {
    const fallback = () =>
      copied.current
        ? paste(copied.current)
        : setNotice(hint('Nichts einzufügen:', 'Erst Teile kopieren, hier oder in einem anderen Modell.'));
    if (!navigator.clipboard?.readText) return fallback();
    navigator.clipboard.readText().then((text) => (isFragment(text) ? paste(text) : fallback()), fallback);
  };
  const chooseRange = (next: ColourRange) => {
    setRange(next);
    if (choice) setChoice({ ...choice, colour: fitColour(choice.familyId, choice.colour, next) });
  };
  const chooseAssortment = (next: Assortment) => {
    setAssortment(next);
    if (choice && !inAssortment(choice.familyId, next)) {
      setChoice(undefined);
      setHover(undefined);
      setPlateHover(undefined);
      setSlideHover(undefined);
    }
  };
  const run = (step: () => readonly Diagnostic[]) => {
    setHover(undefined);
    setPlateHover(undefined);
    setSlideHover(undefined);
    setNotice(unbuildable(step()));
  };

  useEffect(() => storeModel(slot.id, snapshot, { fileName, unsaved }), [slot, snapshot, fileName, unsaved]);
  const title = modelTitle(snapshot.design.name, fileName);
  useEffect(() => {
    document.title = `${title} – Großbaukasten-Editor`;
  }, [title]);
  const rename = (name: string) => {
    const command = renameModel(snapshot, name);
    if (command.operations.length > 0) apply(command);
  };
  // A model built from a building plan counts as unsaved; it has not been saved as a model yet.
  const switchTo = (next: ModelCore, name: string, saved = true) => {
    setCore(next);
    setFileName(name);
    setSavedDesign(saved ? next.snapshot.design : undefined);
    setSelected(undefined);
    setChoice(undefined);
    setHover(undefined);
    setPlateHover(undefined);
    setSlideHover(undefined);
    setNotice(undefined);
  };
  // A new or opened model takes a new slot; the current one stays among the recent models.
  const inFreshSlot = async (next: ModelCore, name: string, saved = true) => {
    setSlot(await freshSlot(slot));
    switchTo(next, name, saved);
  };
  const newModel = () => void inFreshSlot(emptyModel(), DEFAULT_FILE_NAME);
  const openFile = () => fileInput.current?.click();
  const openSlot = async (id: string) => {
    const next = await switchSlot(slot, id);
    if (!next) return setNotice(hint('Nicht geöffnet:', 'Das Modell ist in einem anderen Tab offen.'));
    const stored = restoreModel(id);
    setSlot(next);
    switchTo(stored.core, stored.info.fileName, !stored.info.unsaved);
    if (stored.problems) setNotice({ title: 'Das Modell ließ sich nicht öffnen:', diagnostics: stored.problems });
  };
  const readReference = async (file: File) => {
    const json = await file.text();
    const opened = isPlan(json) ? openPlan(json) : openModel(json);
    if (opened.ok) setReference({ name: file.name, snapshot: opened.value.snapshot });
    else setNotice({ title: `${file.name} ließ sich nicht öffnen:`, diagnostics: opened.diagnostics });
  };
  const readFile = async (file: File) => {
    const json = await file.text();
    const plan = isPlan(json);
    const opened = plan ? openPlan(json) : openModel(json);
    // Saving a plan's model under the plan's name would replace the plan.
    if (opened.ok && plan) {
      await inFreshSlot(opened.value, file.name.replace(/(\.json)?$/i, '-modell.json'), false);
      if (opened.diagnostics.length > 0)
        setNotice({ title: 'Hinweise aus dem Bauplan:', diagnostics: opened.diagnostics, info: true });
    } else if (opened.ok) await inFreshSlot(opened.value, file.name);
    else setNotice({ title: `${file.name} ließ sich nicht öffnen:`, diagnostics: opened.diagnostics });
  };
  const exportBill = () => download(billCsv(bill), 'text/csv', `${fileName.replace(/\.json$/i, '')}-stueckliste.csv`);
  const saveFile = () => {
    const name = modelFileName(snapshot.design.name, fileName);
    downloadModel(snapshot, name);
    setFileName(name);
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
      } else if (!mod && assembly && event.key.startsWith('Arrow')) {
        event.preventDefault();
        const [x, y] = ARROWS[event.key] ?? [0, 0];
        shiftAssembly(x * GRID_MM, y * GRID_MM, 0);
      } else if (!mod && assembly && (event.key === 'PageUp' || event.key === 'PageDown')) {
        event.preventDefault();
        shiftAssembly(0, 0, event.key === 'PageUp' ? GRID_MM : -GRID_MM);
      } else if (!mod && assembly && event.key.toLowerCase() === 'r') {
        shiftAssembly(0, 0, 0, 1);
      } else if (!mod && event.key.toLowerCase() === 'r' && active && active.alternatives > 1) {
        setTurn(turn + 1);
      } else if (!mod && event.key.toLowerCase() === 'r' && !active && turns.length > 0) {
        turnSelected();
      } else if (!mod && event.key === ' ' && active) {
        // Builds what the preview shows, e.g. after turning it with R; a focused button must not fire as well.
        event.preventDefault();
        if (active.preview.status === 'valid') insert(active.command);
      } else if (event.key === 'Delete') {
        event.preventDefault();
        removePicked();
      } else if (mod && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setPicked(new Set(parts.map((p) => p.part.id)));
      } else if (!mod && event.key.toLowerCase() === 'l' && choice?.kind === 'plate') {
        setPlateHover(undefined);
        setChoice({ ...choice, upright: !(choice.upright ?? false) });
      } else if (!mod && event.key.toLowerCase() === 'e') {
        setExploded((e) => !e);
      } else if (!mod && (event.key === '+' || event.key === '-')) {
        zoomBy(event.key === '+' ? 1 : -1);
      } else if (event.key === 'Escape' && assembly) {
        setMoveMode(false);
        setDrag(undefined);
      } else if (event.key === 'Escape') {
        setChoice(undefined);
        setHover(undefined);
        setPlateHover(undefined);
        setSlideHover(undefined);
        setSelected(undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // Ctrl+C, Ctrl+X and Ctrl+V go through the system clipboard, so parts also reach another tab or model.
  useEffect(() => {
    const ownText = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target && (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable);
      return editing || (window.getSelection()?.toString() ?? '') !== '';
    };
    const onCopy = (event: ClipboardEvent, cut: boolean) => {
      if (ownText(event) || picked.size === 0) return;
      event.preventDefault();
      const text = copy();
      if (!text) return;
      event.clipboardData?.setData('text/plain', text);
      if (cut) removePicked();
    };
    const onPlainCopy = (event: ClipboardEvent) => onCopy(event, false);
    const onCut = (event: ClipboardEvent) => onCopy(event, true);
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (!isFragment(text)) return;
      event.preventDefault();
      paste(text);
    };
    document.addEventListener('copy', onPlainCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onPlainCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  });

  const shown = active?.preview.status === 'invalid' ? unbuildable(active.preview.diagnostics) : notice;
  const special = active?.preview.status === 'valid' ? active.preview.variantChanges.filter((c) => c.nonstandard) : [];

  // Sidebar beside or below the model, see index.html.
  return (
    <div className={bottom ? 'layout bottom' : 'layout'}>
      <div className="stage">
        <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 20, display: 'flex', gap: 4 }}>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              title={v.title}
              aria-pressed={camera === v.id}
              onClick={() => (camera === v.id ? setFit(fit + 1) : setCamera(v.id))}
              style={{
                padding: '4px 10px',
                border: camera === v.id ? '2px solid #1f5fbf' : '1px solid #c8cdd3',
                borderRadius: 4,
                background: camera === v.id ? '#e8f0fb' : '#fff',
                cursor: 'pointer',
              }}
            >
              {v.name}
            </button>
          ))}
          <button
            type="button"
            title="Modell einpassen"
            onClick={() => setFit(fit + 1)}
            style={{
              padding: '4px 10px',
              border: '1px solid #c8cdd3',
              borderRadius: 4,
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            Einpassen
          </button>
          {(
            [
              [1, 'Vergrößern (+)', ZoomIn],
              [-1, 'Verkleinern (−)', ZoomOut],
            ] as const
          ).map(([direction, title, Icon]) => (
            <button
              key={direction}
              type="button"
              title={title}
              aria-label={title}
              onClick={() => zoomBy(direction)}
              style={{
                display: 'grid',
                placeItems: 'center',
                padding: '4px 8px',
                border: '1px solid #c8cdd3',
                borderRadius: 4,
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              <Icon size={18} color="#333" aria-hidden />
            </button>
          ))}
          <button
            type="button"
            title="Explosionsansicht: Rohre und Platten kleiner, Kupplungsarme sichtbar (E)"
            aria-label="Explosionsansicht"
            aria-pressed={exploded}
            onClick={() => setExploded(!exploded)}
            style={{
              display: 'grid',
              placeItems: 'center',
              padding: '4px 8px',
              border: exploded ? '2px solid #1f5fbf' : '1px solid #c8cdd3',
              borderRadius: 4,
              background: exploded ? '#e8f0fb' : '#fff',
              cursor: 'pointer',
            }}
          >
            <Expand size={18} color="#333" aria-hidden />
          </button>
        </div>
        {/* On the model rather than in the sidebar, so it costs the sidebar no row. */}
        <select
          aria-label="Seitenleiste"
          title="Wo die Seitenleiste liegt"
          value={dock}
          onChange={(e) => chooseDock(e.target.value as Dock)}
          style={{ position: 'absolute', top: 8, right: 8, zIndex: 20, padding: '4px 6px', fontSize: 14 }}
        >
          {DOCKS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <Canvas
          camera={{ position: [1300, 900, 900], fov: 40, near: 10, far: 50000 }}
          onPointerMissed={() => {
            // A click on the move handle is no click beside the model.
            if (performance.now() - gizmoUsed.current < 400) return;
            setSelected(undefined);
            setHover(undefined);
            setPlateHover(undefined);
            setSlideHover(undefined);
          }}
        >
          <ambientLight intensity={0.7} />
          <directionalLight position={[2000, 3000, 1500]} intensity={1.6} />
          <Grid
            position={[0, -25, 0]}
            cellSize={100}
            sectionSize={400}
            infiniteGrid
            fadeFrom={camera === 'perspective' ? 1 : 0}
            fadeDistance={6000}
            cellColor="#c8cdd3"
            sectionColor="#9aa3ad"
          />
          <ModelScene
            snapshot={snapshot}
            exploded={exploded}
            selected={picked}
            highlighted={assembly ? moved : highlighted}
            marks={rebuild?.marks}
            others={rebuild?.others}
            onSelect={pick1}
            candidate={
              movePlan
                ? movePlan.preview.status === 'valid'
                  ? movePlan.preview.candidate
                  : undefined
                : active?.preview.status === 'valid'
                  ? active.preview.candidate
                  : undefined
            }
            onGhostClick={() => (movePlan ? dropMove() : active && insert(active.command))}
            onGhostHover={previewHover}
          >
            {choice?.kind === 'tube' ? (
              <VirtualArms
                points={points}
                hovered={plan ? { key: plan.key, valid: plan.preview.status === 'valid' } : undefined}
                onHover={(point) => {
                  if (!point) return releasePreview();
                  holdPreview();
                  if (!hover || armKey(point) !== armKey(hover)) setTurn(0);
                  setHover(point);
                }}
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
                  if (!spot) return releasePreview();
                  holdPreview();
                  if (spot.cellKey !== plateHover?.cellKey) setTurn(0);
                  setPlateHover(spot);
                }}
                onPick={placePlate}
              />
            ) : null}
            {choice?.kind === 'slide' ? (
              <SlideSpots
                spots={slideTargets}
                hovered={
                  slidePlan ? { key: slidePlan.spot.key, valid: slidePlan.preview.status === 'valid' } : undefined
                }
                onHover={(spot) => {
                  if (!spot) return releasePreview();
                  holdPreview();
                  setSlideHover(spot);
                }}
                onPick={placeSlide}
              />
            ) : null}
            {active && active.alternatives > 1 ? (
              <GhostTurn
                position={platePlan ? ahead(platePlan.spot.worldPose, 90) : ahead(hover!.worldPose, 120)}
                onTurn={() => setTurn(turn + 1)}
                onHover={previewHover}
              />
            ) : null}
          </ModelScene>
          {selected && selection?.intent ? (
            <SelectionTools
              key={selected}
              partId={selected}
              revision={snapshot.revision}
              colours={selectionColours}
              colour={selection.intent.appearance.colour}
              onRecolour={recolour}
              onDelete={remove}
              onTurn={assembly ? () => shiftAssembly(0, 0, 0, 1) : turns.length > 0 ? turnSelected : undefined}
              moving={assembly !== undefined}
              onMove={() => setMoveMode(!moveMode)}
            />
          ) : null}
          {assembly ? (
            <MoveGizmo
              pivot={assembly.pivot}
              translation={math.vec(drag?.x ?? 0, drag?.y ?? 0, drag?.z ?? 0)}
              label={drag ? drag.label : stepLabel}
              invalid={movePlan?.preview.status === 'invalid'}
              onDrag={dragTo}
              onDragEnd={dropMove}
              onStep={stepAssembly}
              onUse={() => (gizmoUsed.current = performance.now())}
            />
          ) : null}
          <BoxSelect
            isPart={(name) => partNames.has(name)}
            onPick={(names) => setPicked(new Set([...picked, ...names]))}
          />
          <CameraRig view={camera} fit={fit} zoom={zoom} />
        </Canvas>
      </div>
      <aside className="sidebar">
        <header className="masthead">
          <h2 style={{ fontSize: 18 }}>Großbaukasten-Editor</h2>
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
              ref={referenceInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void readReference(file);
              }}
            />
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
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 4px', fontSize: 14 }}>
            Bezeichnung
            <input
              // A new name from elsewhere, e.g. undo or another model, replaces what is typed.
              key={`${slot.id}:${snapshot.design.name ?? ''}`}
              defaultValue={snapshot.design.name ?? ''}
              placeholder={modelTitle(undefined, fileName)}
              onBlur={(e) => rename(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  e.currentTarget.value = snapshot.design.name ?? '';
                  e.currentTarget.blur();
                }
              }}
              style={{ flex: 1, minWidth: 0, padding: '3px 6px', fontSize: 14 }}
            />
          </label>
          <p style={{ fontSize: 13, margin: '0 0 6px', color: '#555', overflowWrap: 'anywhere' }}>
            Datei: {modelFileName(snapshot.design.name, fileName)}
            {unsaved ? <span style={{ color: '#8a5a00' }}> · nicht gespeichert</span> : null}
          </p>
          <RecentModels current={slot.id} onOpen={(id) => void openSlot(id)} />
        </header>
        <div role="tablist" style={{ display: 'flex', gap: 4, margin: '12px 0 0', borderBottom: '1px solid #d0d5db' }}>
          {(
            [
              ['build', 'Bauen'],
              ['bill', 'Stückliste'],
              ['rebuild', 'Umbau'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => {
                setView(id);
                setHighlighted(new Set());
              }}
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
        ) : view === 'rebuild' ? (
          reference && comparison ? (
            <Rebuild
              comparison={comparison}
              reference={reference.name}
              referenceBefore={referenceBefore}
              onlyChanges={onlyChanges}
              onOnlyChanges={setOnlyChanges}
              onSwap={() => setReferenceBefore(!referenceBefore)}
              onOpen={() => referenceInput.current?.click()}
              onClose={() => setReference(undefined)}
              onHighlight={(ids) => setHighlighted(new Set(ids))}
            />
          ) : (
            <section style={{ fontSize: 14 }}>
              <p>
                Vergleicht das aktuelle Modell mit einer zweiten Modelldatei, etwa dem Stand vor einem Umbau: was
                abgebaut, getauscht, versetzt und angebaut wird, und was an Teilen dazu nötig ist.
              </p>
              <button type="button" onClick={() => referenceInput.current?.click()}>
                Vergleichen mit …
              </button>
            </section>
          )
        ) : (
          <>
            {/* Rows wrap only where the sidebar is too narrow for them. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, margin: '14px 0 0' }}>
              <span style={{ color: '#555', fontSize: 14, marginRight: 'auto' }}>
                Revision {snapshot.revision} · {snapshot.realization.parts.length} Teile · {openEnds.length} offene
                Enden{' '}
                <Warnings traps={traps} onHighlight={(ids) => setHighlighted(new Set(ids))} onPick={setSelected} />
              </span>
              <button type="button" disabled={!canUndo} onClick={() => run(undo)} title="Strg+Z">
                Zurück
              </button>
              <button type="button" disabled={!canRedo} onClick={() => run(redo)} title="Strg+Y oder Strg+Umschalt+Z">
                Wiederholen
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: 12, fontSize: 14 }}>
              <label>
                Farben{' '}
                <select value={range} onChange={(e) => chooseRange(e.target.value as ColourRange)}>
                  {COLOUR_RANGES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Teile{' '}
                <select value={assortment} onChange={(e) => chooseAssortment(e.target.value as Assortment)}>
                  {ASSORTMENTS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Palette
              choice={choice}
              range={range}
              assortment={assortment}
              onChoose={(next) => {
                if (next?.familyId !== choice?.familyId) {
                  setHover(undefined);
                  setPlateHover(undefined);
                  setSlideHover(undefined);
                  setTurn(0);
                }
                setChoice(next);
              }}
            />
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
              <section
                style={{
                  fontSize: 14,
                  padding: 8,
                  borderRadius: 4,
                  ...(shown.info
                    ? { background: '#fff6e0', color: '#6b4a00' }
                    : { background: '#fdecea', color: '#8a1c1c' }),
                }}
              >
                <p style={{ margin: '0 0 4px' }}>{shown.title}</p>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {shown.diagnostics.map((d, i) => (
                    <li key={i}>{d.message}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            {/* Heading and delete button share a row; each detail takes one line. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 8px' }}>
              <h3 style={{ fontSize: 15, margin: 0, marginRight: 'auto' }}>Auswahl</h3>
              {picked.size > 0 ? (
                <button type="button" onClick={copyButton} title="Strg+C; Strg+X schneidet aus">
                  Kopieren
                </button>
              ) : null}
              <button type="button" onClick={pasteButton} title="Strg+V: neben dem Modell auf den Boden">
                Einfügen
              </button>
              {picked.size > 1 ? (
                <button type="button" onClick={removePicked} title="Entf">
                  {picked.size} Teile löschen
                </button>
              ) : current && selection ? (
                <button type="button" onClick={remove} title="Entf">
                  {selection.kind === 'plate'
                    ? 'Platte löschen'
                    : selection.kind === 'slide'
                      ? 'Rutsche löschen'
                      : current.part.origin.intent.kind === 'tube'
                        ? 'Rohr löschen'
                        : 'Schräges Rohr löschen'}
                </button>
              ) : null}
            </div>
            {current ? (
              <dl
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  alignItems: 'center',
                  gap: '4px 12px',
                  margin: 0,
                  fontSize: 14,
                }}
              >
                <dt>Teil</dt>
                <dd style={{ margin: 0 }}>
                  {articleName(current.part.typeId)}
                  <span style={{ color: '#555' }}> · {current.article?.article.articleNumber ?? '–'}</span>
                </dd>
                <dt>Farbe</dt>
                <dd style={{ margin: 0 }}>
                  {selection?.intent ? (
                    <select value={selection.intent.appearance.colour} onChange={(e) => recolour(e.target.value)}>
                      {selectionColours.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    colourName(current.article?.article.colour)
                  )}
                  {current.article?.substituted ? ' (Ersatzfarbe)' : ''}
                </dd>
                <dt>ID</dt>
                <dd style={{ margin: 0, fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{current.part.id}</dd>
              </dl>
            ) : picked.size > 1 ? (
              <p style={{ fontSize: 14, margin: 0 }}>{picked.size} Teile ausgewählt.</p>
            ) : (
              <p style={{ fontSize: 14, margin: 0 }}>
                Teil anklicken für Details. Umschalt+Klick oder Umschalt+Ziehen wählt mehrere, Strg+A alle; Strg+C und
                Strg+V kopieren sie, auch in ein anderes Modell.
              </p>
            )}
            {current && !selection ? (
              <p style={{ fontSize: 13, color: '#555' }}>
                Kupplungen entstehen automatisch aus den Rohren und verschwinden mit ihnen.
              </p>
            ) : null}
          </>
        )}
      </aside>
    </div>
  );
}
