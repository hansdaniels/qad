import { nextId } from './attach.js';
import type { EditCommand, DesignOperation } from './commands.js';
import type { ConstructionSnapshot } from './core.js';
import type { ColourId, JunctionId, PartId, PlateId, SlideId, TubeId } from './ids.js';

/**
 * The tube a part stands for: a tube's own body, or the oblique tube an angle
 * adapter carries. Connectors follow from their tubes and stand for none.
 */
export function tubeOfPart(snapshot: ConstructionSnapshot, partId: PartId): TubeId | undefined {
  const part = snapshot.realization.parts.find((p) => p.id === partId);
  if (!part) return undefined;
  if (part.origin.intent.kind === 'tube') return part.origin.intent.id;
  const adapter = /^angle-adapter:(.+):[ab]$/.exec(part.origin.role);
  return adapter?.[1];
}

/** Command that names the model; blank text takes its name away. */
export function renameModel(snapshot: ConstructionSnapshot, name: string): EditCommand {
  const trimmed = name.trim();
  return {
    baseRevision: snapshot.revision,
    operations:
      trimmed === (snapshot.design.name ?? '') ? [] : [{ kind: 'set-name', ...(trimmed ? { name: trimmed } : {}) }],
  };
}

/** The plate a part realises. */
export function plateOfPart(snapshot: ConstructionSnapshot, partId: PartId): PlateId | undefined {
  const part = snapshot.realization.parts.find((p) => p.id === partId);
  return part?.origin.intent.kind === 'plate' ? part.origin.intent.id : undefined;
}

/** Command that gives a plate another colour. */
export function recolourPlate(snapshot: ConstructionSnapshot, plateId: PlateId, colour: ColourId): EditCommand {
  const plate = snapshot.design.plates.find((p) => p.id === plateId);
  return {
    baseRevision: snapshot.revision,
    operations: plate ? [{ kind: 'set-plate', plate: { ...plate, appearance: { colour } } }] : [],
  };
}

/** Command that removes a plate; the tubes keep their drilling variant. */
export function removePlate(snapshot: ConstructionSnapshot, plateId: PlateId): EditCommand {
  const exists = snapshot.design.plates.some((p) => p.id === plateId);
  return {
    baseRevision: snapshot.revision,
    operations: exists ? [{ kind: 'remove-intent', target: { kind: 'plate', id: plateId } }] : [],
  };
}

/** The slide body or runout a part realises. */
export function slideOfPart(snapshot: ConstructionSnapshot, partId: PartId): SlideId | undefined {
  const part = snapshot.realization.parts.find((p) => p.id === partId);
  return part?.origin.intent.kind === 'slide' ? part.origin.intent.id : undefined;
}

/** Command that gives a slide another colour. */
export function recolourSlide(snapshot: ConstructionSnapshot, slideId: SlideId, colour: ColourId): EditCommand {
  const slide = snapshot.design.slides.find((s) => s.id === slideId);
  return {
    baseRevision: snapshot.revision,
    operations: slide ? [{ kind: 'set-slide', slide: { ...slide, appearance: { colour } } }] : [],
  };
}

/** Command that removes a slide body or runout. */
export function removeSlide(snapshot: ConstructionSnapshot, slideId: SlideId): EditCommand {
  const exists = snapshot.design.slides.some((s) => s.id === slideId);
  return {
    baseRevision: snapshot.revision,
    operations: exists ? [{ kind: 'remove-intent', target: { kind: 'slide', id: slideId } }] : [],
  };
}

/** Command that gives a tube another colour. */
export function recolourTube(snapshot: ConstructionSnapshot, tubeId: TubeId, colour: ColourId): EditCommand {
  const tube = snapshot.design.tubes.find((t) => t.id === tubeId);
  return {
    baseRevision: snapshot.revision,
    operations: tube ? [{ kind: 'set-tube', tube: { ...tube, appearance: { colour } } }] : [],
  };
}

/**
 * Command that gives the tubes, plates and slides the parts stand for one colour
 * in one step; connectors stand for none, and parts already in it stay as they are.
 */
export function recolourParts(
  snapshot: ConstructionSnapshot,
  partIds: readonly PartId[],
  colour: ColourId,
): EditCommand {
  const { design } = snapshot;
  const ids = (of: (s: ConstructionSnapshot, id: PartId) => string | undefined) =>
    new Set(partIds.flatMap((id) => of(snapshot, id) ?? []));
  const [tubes, plates, slides] = [ids(tubeOfPart), ids(plateOfPart), ids(slideOfPart)];
  const other = (appearance: { readonly colour: ColourId }) => appearance.colour !== colour;
  return {
    baseRevision: snapshot.revision,
    operations: [
      ...design.tubes
        .filter((t) => tubes.has(t.id) && other(t.appearance))
        .map((tube): DesignOperation => ({ kind: 'set-tube', tube: { ...tube, appearance: { colour } } })),
      ...design.plates
        .filter((p) => plates.has(p.id) && other(p.appearance))
        .map((plate): DesignOperation => ({ kind: 'set-plate', plate: { ...plate, appearance: { colour } } })),
      ...design.slides
        .filter((s) => slides.has(s.id) && other(s.appearance))
        .map((slide): DesignOperation => ({ kind: 'set-slide', slide: { ...slide, appearance: { colour } } })),
    ],
  };
}

/**
 * Command that removes a tube. Plates screwed to it, slides hanging on it and junctions left without
 * tubes go as well, except anchored junctions. If the model falls apart, every
 * assembly without an anchor gets one at its current place, so nothing moves.
 */
export function removeTube(snapshot: ConstructionSnapshot, tubeId: TubeId): EditCommand {
  return removeIntents(snapshot, new Set([tubeId]), new Set(), new Set());
}

/**
 * Command that removes the tubes, plates and slides the parts stand for in one
 * step, as removeTube does for each tube; connectors stand for none.
 */
export function removeParts(snapshot: ConstructionSnapshot, partIds: readonly PartId[]): EditCommand {
  return removeIntents(
    snapshot,
    new Set(partIds.flatMap((id) => tubeOfPart(snapshot, id) ?? [])),
    new Set(partIds.flatMap((id) => plateOfPart(snapshot, id) ?? [])),
    new Set(partIds.flatMap((id) => slideOfPart(snapshot, id) ?? [])),
  );
}

function removeIntents(
  snapshot: ConstructionSnapshot,
  gone: ReadonlySet<TubeId>,
  plates: ReadonlySet<PlateId>,
  slides: ReadonlySet<SlideId>,
): EditCommand {
  const { design, realization } = snapshot;
  const tubes = design.tubes.filter((t) => gone.has(t.id));
  const nothing =
    tubes.length === 0 && !design.plates.some((p) => plates.has(p.id)) && !design.slides.some((s) => slides.has(s.id));
  if (nothing) return { baseRevision: snapshot.revision, operations: [] };
  const remaining = design.tubes.filter((t) => !gone.has(t.id));
  const used = new Set(remaining.flatMap((t) => [t.a.junctionId, t.b.junctionId]));
  const anchored = new Set(design.anchors.flatMap((a) => (a.target.kind === 'junction' ? [a.target.id] : [])));
  const operations: DesignOperation[] = [
    ...design.plates
      .filter((p) => plates.has(p.id) || p.mounts.some((m) => gone.has(m.tubeId)))
      .map((p): DesignOperation => ({ kind: 'remove-intent', target: { kind: 'plate', id: p.id } })),
    ...design.slides
      .filter((s) => slides.has(s.id) || gone.has(s.tubeId))
      .map((s): DesignOperation => ({ kind: 'remove-intent', target: { kind: 'slide', id: s.id } })),
    ...tubes.map((t): DesignOperation => ({ kind: 'remove-intent', target: { kind: 'tube', id: t.id } })),
  ];
  for (const anchor of design.anchors) {
    if (anchor.target.kind === 'tube' && gone.has(anchor.target.id))
      operations.push({ kind: 'remove-anchor', id: anchor.id });
  }
  for (const junctionId of new Set(tubes.flatMap((t) => [t.a.junctionId, t.b.junctionId]))) {
    if (!used.has(junctionId) && !anchored.has(junctionId)) {
      operations.push({ kind: 'remove-intent', target: { kind: 'junction', id: junctionId } });
    }
  }

  // Assemblies of the remaining tubes; one without an anchor gets one where it is.
  const tubeAnchors = new Set(design.anchors.flatMap((a) => (a.target.kind === 'tube' ? [a.target.id] : [])));
  const neighbours = new Map<JunctionId, JunctionId[]>();
  for (const t of remaining) {
    neighbours.set(t.a.junctionId, [...(neighbours.get(t.a.junctionId) ?? []), t.b.junctionId]);
    neighbours.set(t.b.junctionId, [...(neighbours.get(t.b.junctionId) ?? []), t.a.junctionId]);
  }
  const seen = new Set<JunctionId>();
  const anchorIds = design.anchors.map((a) => a.id);
  for (const start of [...neighbours.keys()].sort()) {
    if (seen.has(start)) continue;
    const component: JunctionId[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const j = queue.shift()!;
      component.push(j);
      for (const n of neighbours.get(j) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    const hasAnchor =
      component.some((j) => anchored.has(j)) ||
      remaining.some((t) => tubeAnchors.has(t.id) && component.includes(t.a.junctionId));
    if (hasAnchor) continue;
    const junctionId = [...component].sort()[0]!;
    const frame = realization.intentPoses.find((p) => p.intent.kind === 'junction' && p.intent.id === junctionId);
    if (!frame) continue;
    const id = nextId('anchor', anchorIds);
    anchorIds.push(id);
    operations.push({
      kind: 'set-anchor',
      anchor: { id, target: { kind: 'junction', id: junctionId }, worldPose: frame.worldPose },
    });
  }
  return { baseRevision: snapshot.revision, operations };
}
