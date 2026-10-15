import { nextId } from './attach.js';
import type { EditCommand, DesignOperation } from './commands.js';
import type { ConstructionSnapshot } from './core.js';
import type { ColourId, JunctionId, PartId, TubeId } from './ids.js';

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

/** Command that gives a tube another colour. */
export function recolourTube(snapshot: ConstructionSnapshot, tubeId: TubeId, colour: ColourId): EditCommand {
  const tube = snapshot.design.tubes.find((t) => t.id === tubeId);
  return {
    baseRevision: snapshot.revision,
    operations: tube ? [{ kind: 'set-tube', tube: { ...tube, appearance: { colour } } }] : [],
  };
}

/**
 * Command that removes a tube. Junctions left without tubes go as well, except
 * anchored ones. If the model falls apart, every assembly without an anchor gets
 * one at its current place, so nothing moves.
 */
export function removeTube(snapshot: ConstructionSnapshot, tubeId: TubeId): EditCommand {
  const { design, realization } = snapshot;
  const tube = design.tubes.find((t) => t.id === tubeId);
  if (!tube) return { baseRevision: snapshot.revision, operations: [] };
  const remaining = design.tubes.filter((t) => t.id !== tubeId);
  const used = new Set(remaining.flatMap((t) => [t.a.junctionId, t.b.junctionId]));
  const anchored = new Set(design.anchors.flatMap((a) => (a.target.kind === 'junction' ? [a.target.id] : [])));
  const operations: DesignOperation[] = [{ kind: 'remove-intent', target: { kind: 'tube', id: tubeId } }];
  for (const anchor of design.anchors) {
    if (anchor.target.kind === 'tube' && anchor.target.id === tubeId)
      operations.push({ kind: 'remove-anchor', id: anchor.id });
  }
  for (const junctionId of new Set([tube.a.junctionId, tube.b.junctionId])) {
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
