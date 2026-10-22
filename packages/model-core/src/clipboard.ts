import { nextId } from './attach.js';
import type { PartCatalog } from './catalog.js';
import type { DesignOperation, EditCommand } from './commands.js';
import type { ConstructionSnapshot } from './core.js';
import type { ConstructionDesign, PlacementAnchor } from './design.js';
import type { Result } from './diagnostics.js';
import { plateOfPart, slideOfPart, tubeOfPart } from './edits.js';
import type { Vector3 } from './geometry.js';
import type { JunctionId, PartId, PlateId, SlideId, TubeId } from './ids.js';
import { add, vec } from './math.js';
import { parseFragmentJson } from './parse-document.js';
import { restingTubes, slideEnds } from './slides.js';

/**
 * Copied parts: a design of their own, with one anchor per assembly where it
 * stood, and the box they took up there. Pasted into any model with new IDs.
 */
export interface Fragment {
  readonly design: ConstructionDesign;
  /** Junction centres and lower slide ends, world coordinates when copied. */
  readonly bounds: { readonly min: Vector3; readonly max: Vector3 };
}

/** Pasted copies stand two grid steps of a 35 cm tube beside the model, on the grid. */
const GRID_MM = 400;
const GAP_MM = 2 * GRID_MM;

/**
 * The tubes, plates and slides the parts stand for, as a fragment. A plate or
 * slide brings the tubes it is fixed to or rests on; connectors follow from the
 * tubes. Undefined when the parts stand for no tube.
 */
export function copyParts(
  snapshot: ConstructionSnapshot,
  catalog: PartCatalog,
  partIds: readonly PartId[],
): Fragment | undefined {
  const { design } = snapshot;
  const plateIds = new Set<PlateId>(partIds.flatMap((id) => plateOfPart(snapshot, id) ?? []));
  const slideIds = new Set<SlideId>(partIds.flatMap((id) => slideOfPart(snapshot, id) ?? []));
  const tubeIds = new Set<TubeId>([
    ...partIds.flatMap((id) => tubeOfPart(snapshot, id) ?? []),
    ...design.plates.filter((p) => plateIds.has(p.id)).flatMap((p) => p.mounts.map((m) => m.tubeId)),
    ...design.slides.filter((s) => slideIds.has(s.id)).map((s) => s.tubeId),
    ...restingTubes(snapshot, catalog, slideIds),
  ]);
  const tubes = design.tubes.filter((t) => tubeIds.has(t.id));
  if (tubes.length === 0) return undefined;
  const junctionIds = new Set(tubes.flatMap((t) => [t.a.junctionId, t.b.junctionId]));
  const frames = new Map(
    snapshot.realization.intentPoses.flatMap((p) => (p.intent.kind === 'junction' ? [[p.intent.id, p.worldPose]] : [])),
  );
  // One anchor per assembly of the copied tubes, at its first junction where it is now.
  const anchors: PlacementAnchor[] = components(tubes).flatMap((component, k) => {
    const junctionId = [...component].sort()[0]!;
    const worldPose = frames.get(junctionId);
    return worldPose ? [{ id: `anchor${k + 1}`, target: { kind: 'junction', id: junctionId }, worldPose }] : [];
  });
  const points = [
    ...[...junctionIds].flatMap((id) => frames.get(id)?.position ?? []),
    ...slideEnds(snapshot, catalog, slideIds),
  ];
  return {
    design: {
      id: design.id,
      catalog: design.catalog,
      tubes,
      junctions: design.junctions.filter((j) => junctionIds.has(j.id)),
      plates: design.plates.filter((p) => plateIds.has(p.id) && junctionIds.has(p.placement.junctionId)),
      slides: design.slides.filter((s) => slideIds.has(s.id)),
      anchors,
    },
    bounds: box(points),
  };
}

/**
 * Command that adds the fragment with new IDs beside the model, its lowest
 * junction on the floor. A model without tubes gives up its start point instead,
 * and the copy stands where it stood.
 */
export function pasteFragment(
  snapshot: ConstructionSnapshot,
  catalog: PartCatalog,
  fragment: Fragment,
  /** Further grid steps away, e.g. when the first place collides. */
  further = 0,
): EditCommand {
  const { design } = snapshot;
  const { min } = fragment.bounds;
  const points = [
    ...snapshot.realization.intentPoses.flatMap((p) => (p.intent.kind === 'junction' ? [p.worldPose.position] : [])),
    ...slideEnds(snapshot, catalog, new Set(design.slides.map((s) => s.id))),
  ];
  const empty = design.tubes.length === 0;
  const target = !empty && points.length > 0 ? box(points) : undefined;
  const offset = vec(
    (target ? Math.ceil((target.max.x + GAP_MM - min.x) / GRID_MM) * GRID_MM : 0) + further * GRID_MM,
    target ? Math.round((target.min.y - min.y) / GRID_MM) * GRID_MM : 0,
    -min.z,
  );

  const junction = renaming('j', design.junctions);
  const tube = renaming('t', design.tubes);
  const plate = renaming('p', design.plates);
  const slide = renaming('s', design.slides);
  const anchor = renaming('anchor', design.anchors);
  const part = fragment.design;
  const operations: DesignOperation[] = [
    ...(empty
      ? [
          ...design.anchors.map((a): DesignOperation => ({ kind: 'remove-anchor', id: a.id })),
          ...design.junctions.map((j): DesignOperation => ({
            kind: 'remove-intent',
            target: { kind: 'junction', id: j.id },
          })),
        ]
      : []),
    ...part.junctions.map((j): DesignOperation => ({ kind: 'add-junction', junction: { ...j, id: junction(j.id) } })),
    ...part.tubes.map((t): DesignOperation => ({
      kind: 'add-tube',
      tube: {
        ...t,
        id: tube(t.id),
        a: { ...t.a, junctionId: junction(t.a.junctionId) },
        b: { ...t.b, junctionId: junction(t.b.junctionId) },
      },
    })),
    ...part.plates.map((p): DesignOperation => ({
      kind: 'add-plate',
      plate: {
        ...p,
        id: plate(p.id),
        placement: { ...p.placement, junctionId: junction(p.placement.junctionId) },
        mounts: p.mounts.map((m) => ({ ...m, tubeId: tube(m.tubeId) })),
      },
    })),
    ...part.slides.map((s): DesignOperation => ({
      kind: 'add-slide',
      slide: { ...s, id: slide(s.id), tubeId: tube(s.tubeId) },
    })),
    ...part.anchors.map((a): DesignOperation => ({
      kind: 'set-anchor',
      anchor: {
        id: anchor(a.id),
        target: { ...a.target, id: a.target.kind === 'tube' ? tube(a.target.id) : junction(a.target.id) },
        worldPose: { ...a.worldPose, position: add(a.worldPose.position, offset) },
      },
    })),
  ];
  return { baseRevision: snapshot.revision, operations };
}

const FORMAT = 'qad-fragment';

/** JSON of copied parts for the clipboard. */
export function encodeFragment(fragment: Fragment): string {
  return JSON.stringify({ format: FORMAT, schemaVersion: 1, ...fragment });
}

/** Whether text looks like copied parts, before checking it in full. */
export function isFragment(text: string): boolean {
  try {
    return (JSON.parse(text) as { format?: unknown } | null)?.format === FORMAT;
  } catch {
    return false;
  }
}

/** Copied parts from untrusted text, for a model of the same catalog. */
export function parseFragment(text: string, catalog: PartCatalog): Result<Fragment> {
  const parsed = parseFragmentJson(text);
  if (!parsed.ok) return parsed;
  const { id, version } = parsed.value.design.catalog;
  if (id !== catalog.ref.id || version !== catalog.ref.version) {
    return {
      ok: false,
      diagnostics: [
        {
          code: 'catalog-mismatch',
          severity: 'error',
          message: 'Die kopierten Teile stammen aus einem anderen Teilekatalog.',
          subjects: [],
          details: { expected: `${catalog.ref.id}@${catalog.ref.version}`, actual: `${id}@${version}` },
        },
      ],
    };
  }
  return parsed;
}

/** New IDs in the model for those of the fragment, the same one for the same old ID. */
function renaming(prefix: string, existing: readonly { readonly id: string }[]): (old: string) => string {
  const taken = existing.map((e) => e.id);
  const renamed = new Map<string, string>();
  return (old) => {
    let id = renamed.get(old);
    if (!id) {
      id = nextId(prefix, taken);
      taken.push(id);
      renamed.set(old, id);
    }
    return id;
  };
}

/** Junctions joined by the tubes, one set per assembly. */
function components(tubes: ConstructionDesign['tubes']): Set<JunctionId>[] {
  const neighbours = new Map<JunctionId, JunctionId[]>();
  for (const t of tubes) {
    neighbours.set(t.a.junctionId, [...(neighbours.get(t.a.junctionId) ?? []), t.b.junctionId]);
    neighbours.set(t.b.junctionId, [...(neighbours.get(t.b.junctionId) ?? []), t.a.junctionId]);
  }
  const seen = new Set<JunctionId>();
  const result: Set<JunctionId>[] = [];
  for (const start of [...neighbours.keys()].sort()) {
    if (seen.has(start)) continue;
    const component = new Set([start]);
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      for (const n of neighbours.get(queue.shift()!) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          component.add(n);
          queue.push(n);
        }
      }
    }
    result.push(component);
  }
  return result;
}

function box(points: readonly Vector3[]): { min: Vector3; max: Vector3 } {
  const along = (axis: 'x' | 'y' | 'z', pick: (...v: number[]) => number) => pick(...points.map((p) => p[axis]));
  return {
    min: vec(along('x', Math.min), along('y', Math.min), along('z', Math.min)),
    max: vec(along('x', Math.max), along('y', Math.max), along('z', Math.max)),
  };
}
